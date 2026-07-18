/*
 * PC-004 proof-of-concept tier-1 audio sidecar (miniaudio).
 *
 * Control protocol: newline-delimited commands on stdin, newline-delimited
 * JSON events on stdout (the daemon owns the pipe; nothing else prints).
 *
 *   LOAD <path>        decode + prepare looping data source
 *   PLAY               start gapless loop (fade-in over FADE_MS)
 *   VOLUME <0-100>     perceptual volume (mapped to amplitude by ^3 curve)
 *   FADEOUT <ms>       ramp gain to 0 over <ms>, then exit(0)
 *   QUIT               stop immediately and exit(0)
 *
 * Flags: --null  use miniaudio's null backend (no sound card; CI/agent runs)
 *
 * Gaplessness: the decoder is wrapped in ma_data_source_set_looping(), which
 * wraps sample-accurately inside the read callback — the device callback
 * never observes an end-of-stream, so there is no seam to glitch on.
 *
 * Build: cc -O2 -s -o purr-sidecar purr-sidecar.c -lm -lpthread -ldl
 * (miniaudio dlopen()s ALSA/PulseAudio/CoreAudio/WASAPI at runtime — no
 * audio dev packages needed at build time.)
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#include "vendor/miniaudio.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

static double g_t0;
static void emit(const char* event, const char* fmt, ...) {
    printf("{\"t\":%.1f,\"event\":\"%s\"", now_ms() - g_t0, event);
    if (fmt && *fmt) {
        printf(",");
        va_list args;
        va_start(args, fmt);
        vprintf(fmt, args);
        va_end(args);
    }
    printf("}\n");
    fflush(stdout);
}

/* ---- playback state shared with the audio callback ---------------------- */
typedef struct {
    ma_decoder decoder;
    ma_bool32 loaded;
    ma_bool32 playing;
    float gain;          /* current applied gain (ramped)   */
    float target_gain;   /* where the ramp is heading       */
    float ramp_per_frame;/* gain step per frame             */
    ma_bool32 exit_after_ramp;
    ma_uint64 frames_rendered;
    ma_uint64 loop_wraps;
    ma_uint64 last_cursor;
} playback_t;

static playback_t P = {0};

static float perceptual_to_amplitude(int v) {
    if (v <= 0) return 0.0f;
    if (v > 100) v = 100;
    float x = v / 100.0f;
    return x * x * x; /* cubic approximation of equal-loudness; PC-205 refines */
}

static void data_callback(ma_device* dev, void* out, const void* in, ma_uint32 frames) {
    (void)in;
    float* f32 = (float*)out;
    ma_uint32 channels = dev->playback.channels;
    memset(out, 0, (size_t)frames * channels * sizeof(float));
    if (!P.loaded || !P.playing) return;

    ma_uint64 read = 0;
    ma_data_source_read_pcm_frames(&P.decoder, f32, frames, &read);
    /* looping data source: 'read' only falls short if the file is unreadable */

    ma_uint64 cursor = 0;
    ma_data_source_get_cursor_in_pcm_frames(&P.decoder, &cursor);
    if (cursor < P.last_cursor) P.loop_wraps++;
    P.last_cursor = cursor;

    for (ma_uint32 i = 0; i < frames; i++) {
        if (P.gain != P.target_gain) {
            float step = P.ramp_per_frame;
            if (P.gain < P.target_gain) {
                P.gain += step;
                if (P.gain > P.target_gain) P.gain = P.target_gain;
            } else {
                P.gain -= step;
                if (P.gain < P.target_gain) P.gain = P.target_gain;
            }
        }
        for (ma_uint32 c = 0; c < channels; c++) f32[i * channels + c] *= P.gain;
    }
    P.frames_rendered += frames;

    if (P.exit_after_ramp && P.gain == 0.0f) {
        P.playing = MA_FALSE; /* main thread notices and exits */
    }
}

int main(int argc, char** argv) {
    g_t0 = now_ms();
    ma_bool32 use_null = (argc > 1 && strcmp(argv[1], "--null") == 0);

    ma_context context;
    ma_backend null_backends[] = { ma_backend_null };
    if (ma_context_init(use_null ? null_backends : NULL, use_null ? 1 : 0, NULL, &context) != MA_SUCCESS) {
        emit("error", "\"detail\":\"context init failed\"");
        return 1;
    }

    ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
    cfg.playback.format = ma_format_f32;
    cfg.playback.channels = 2;
    cfg.sampleRate = 48000;
    cfg.dataCallback = data_callback;

    ma_device device;
    if (ma_device_init(&context, &cfg, &device) != MA_SUCCESS) {
        emit("error", "\"detail\":\"device init failed\"");
        return 1;
    }
    ma_device_start(&device);
    emit("ready", "\"backend\":\"%s\",\"sampleRate\":%u",
         ma_get_backend_name(context.backend), device.sampleRate);

    char line[1024];
    ma_bool32 want_exit = MA_FALSE;
    while (!want_exit && fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\r\n")] = 0;
        if (strncmp(line, "LOAD ", 5) == 0) {
            if (P.loaded) { P.playing = MA_FALSE; ma_decoder_uninit(&P.decoder); P.loaded = MA_FALSE; }
            ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, 48000);
            if (ma_decoder_init_file(line + 5, &dcfg, &P.decoder) == MA_SUCCESS) {
                ma_data_source_set_looping(&P.decoder, MA_TRUE);
                ma_uint64 len = 0;
                ma_data_source_get_length_in_pcm_frames(&P.decoder, &len);
                P.loaded = MA_TRUE;
                P.last_cursor = 0;
                P.loop_wraps = 0;
                emit("loaded", "\"path\":\"%s\",\"frames\":%llu", line + 5, (unsigned long long)len);
            } else {
                emit("error", "\"detail\":\"decode failed\",\"path\":\"%s\"", line + 5);
            }
        } else if (strcmp(line, "PLAY") == 0 && P.loaded) {
            P.gain = 0.0f;
            if (P.target_gain <= 0.0f) P.target_gain = perceptual_to_amplitude(20);
            P.ramp_per_frame = P.target_gain / (0.5f * device.sampleRate); /* 500ms fade-in */
            P.playing = MA_TRUE;
            emit("playing", "\"fadeInMs\":500,\"targetGain\":%.4f", P.target_gain);
        } else if (strncmp(line, "VOLUME ", 7) == 0) {
            int v = atoi(line + 7);
            float amp = perceptual_to_amplitude(v);
            P.ramp_per_frame = fabsf(amp - P.gain) / (0.1f * device.sampleRate); /* 100ms ramp */
            P.target_gain = amp;
            emit("volume", "\"perceptual\":%d,\"amplitude\":%.4f,\"rampMs\":100", v, amp);
        } else if (strncmp(line, "FADEOUT ", 8) == 0) {
            int ms = atoi(line + 8);
            if (ms < 1) ms = 1;
            P.ramp_per_frame = P.gain / ((ms / 1000.0f) * device.sampleRate);
            P.target_gain = 0.0f;
            P.exit_after_ramp = MA_TRUE;
            emit("fadeout", "\"ms\":%d", ms);
            /* wait for the callback to finish the ramp */
            while (P.playing) ma_sleep(10);
            want_exit = MA_TRUE;
        } else if (strcmp(line, "QUIT") == 0) {
            want_exit = MA_TRUE;
        } else if (strcmp(line, "STATS") == 0) {
            emit("stats", "\"framesRendered\":%llu,\"loopWraps\":%llu,\"gain\":%.4f",
                 (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps, P.gain);
        }
    }

    emit("exiting", "\"framesRendered\":%llu,\"loopWraps\":%llu",
         (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
    ma_device_uninit(&device);
    if (P.loaded) ma_decoder_uninit(&P.decoder);
    ma_context_uninit(&context);
    return 0;
}
