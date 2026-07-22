#if !defined(_WIN32)
#define _POSIX_C_SOURCE 200809L
#endif

/*
 * PurrCode tier-1 audio sidecar (PC-301 / ADR 0004).
 *
 * Control protocol: newline-delimited JSON on stdin; JSON events on stdout.
 * Amplitude is linear [0,1] — the Node adapter applies PC-205 perceptual→amplitude.
 *
 * Commands:
 *   {"cmd":"load","path":"<file>"}
 *   {"cmd":"play","fadeInMs":500}          // optional fadeInMs (default 500)
 *   {"cmd":"volume","amplitude":0.1,"rampMs":100}
 *   {"cmd":"fadeout","ms":400}             // ramp to 0; emit stopped (stay alive)
 *   {"cmd":"quit"}                         // exit immediately
 *   {"cmd":"stats"}
 *
 * Flags: --null  use miniaudio null backend (no sound card; CI / agent runs)
 *
 * Gaplessness: ma_data_source_set_looping() wraps sample-accurately.
 * Orphan safety: stdin EOF → exit.
 *
 * Decoders: WAV (built-in) + OGG Vorbis via stb_vorbis (ADR 0004 amendment).
 * MP3/FLAC/generation disabled to keep the binary a few hundred KB.
 */

#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_MP3
#define MA_NO_FLAC

#define STB_VORBIS_HEADER_ONLY
#include "../vendor/stb_vorbis.c"

#define MINIAUDIO_IMPLEMENTATION
#include "../vendor/miniaudio.h"

#undef STB_VORBIS_HEADER_ONLY
#include "../vendor/stb_vorbis.c"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <math.h>
#include <ctype.h>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#else
#include <time.h>
#include <unistd.h>
#include <sys/select.h>
#endif

static double now_ms(void) {
#if defined(_WIN32)
    static LARGE_INTEGER freq;
    static int init = 0;
    LARGE_INTEGER counter;
    if (!init) {
        QueryPerformanceFrequency(&freq);
        init = 1;
    }
    QueryPerformanceCounter(&counter);
    return (double)counter.QuadPart * 1000.0 / (double)freq.QuadPart;
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
#endif
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
    float gain;           /* current applied gain (ramped) */
    float target_gain;    /* where the ramp is heading */
    float ramp_per_frame; /* gain step per frame */
    ma_bool32 stop_after_ramp;
    ma_bool32 pending_stopped; /* emit "stopped" once fade-out completes */
    float last_amplitude;      /* last volume command; used after fade-cancel */
    ma_bool32 volume_set;
    ma_uint32 sample_rate;
    ma_uint64 frames_rendered;
    ma_uint64 loop_wraps;
    ma_uint64 last_cursor;
} playback_t;

static playback_t P = {0};

static float clamp_amplitude(float a) {
    if (!(a > 0.0f)) return 0.0f;
    if (a > 1.0f) return 1.0f;
    return a;
}

static void data_callback(ma_device* dev, void* out, const void* in, ma_uint32 frames) {
    (void)in;
    float* f32 = (float*)out;
    ma_uint32 channels = dev->playback.channels;
    memset(out, 0, (size_t)frames * channels * sizeof(float));
    if (!P.loaded || !P.playing) return;

    ma_uint64 read = 0;
    ma_data_source_read_pcm_frames(&P.decoder, f32, frames, &read);

    ma_uint64 cursor = 0;
    ma_data_source_get_cursor_in_pcm_frames(&P.decoder, &cursor);
    if (cursor < P.last_cursor) P.loop_wraps++;
    P.last_cursor = cursor;

    for (ma_uint32 i = 0; i < frames; i++) {
        if (P.gain != P.target_gain) {
            float step = P.ramp_per_frame;
            if (step <= 0.0f) {
                P.gain = P.target_gain;
            } else if (P.gain < P.target_gain) {
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

    if (P.stop_after_ramp && P.gain == 0.0f) {
        P.playing = MA_FALSE;
        P.stop_after_ramp = MA_FALSE;
        P.pending_stopped = MA_TRUE;
    }
}

/* Minimal JSON field extractors (no network, no heap JSON lib). */
static const char* find_key(const char* json, const char* key) {
    char pattern[64];
    size_t key_len = strlen(key);
    if (key_len + 4 >= sizeof pattern) return NULL;
    pattern[0] = '"';
    memcpy(pattern + 1, key, key_len);
    pattern[1 + key_len] = '"';
    pattern[2 + key_len] = '\0';
    const char* p = strstr(json, pattern);
    if (!p) return NULL;
    p += key_len + 2;
    while (*p && (isspace((unsigned char)*p) || *p == ':')) p++;
    return *p ? p : NULL;
}

static int json_string(const char* json, const char* key, char* out, size_t out_len) {
    const char* p = find_key(json, key);
    if (!p || *p != '"') return 0;
    p++;
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < out_len) {
        if (*p == '\\' && p[1]) {
            p++;
            out[i++] = *p++;
        } else {
            out[i++] = *p++;
        }
    }
    if (*p != '"') return 0;
    out[i] = '\0';
    return 1;
}

static int json_number(const char* json, const char* key, double* out) {
    const char* p = find_key(json, key);
    if (!p) return 0;
    char* end = NULL;
    double v = strtod(p, &end);
    if (end == p) return 0;
    *out = v;
    return 1;
}

static void set_ramp_to(float target, int ramp_ms) {
    float amp = clamp_amplitude(target);
    if (ramp_ms < 1) ramp_ms = 1;
    float sr = P.sample_rate > 0 ? (float)P.sample_rate : 48000.0f;
    float delta = fabsf(amp - P.gain);
    P.ramp_per_frame = delta / ((ramp_ms / 1000.0f) * sr);
    P.target_gain = amp;
}

static int handle_line(const char* line, ma_device* device) {
    char cmd[32];
    if (!json_string(line, "cmd", cmd, sizeof cmd)) {
        emit("error", "\"detail\":\"missing cmd\"");
        return 0;
    }

    if (strcmp(cmd, "load") == 0) {
        char path[1024];
        if (!json_string(line, "path", path, sizeof path) || path[0] == '\0') {
            emit("error", "\"detail\":\"load requires path\"");
            return 0;
        }
        if (P.loaded) {
            P.playing = MA_FALSE;
            ma_decoder_uninit(&P.decoder);
            P.loaded = MA_FALSE;
        }
        ma_decoder_config dcfg = ma_decoder_config_init(ma_format_f32, 2, device->sampleRate);
        if (ma_decoder_init_file(path, &dcfg, &P.decoder) == MA_SUCCESS) {
            ma_data_source_set_looping(&P.decoder, MA_TRUE);
            ma_uint64 len = 0;
            ma_data_source_get_length_in_pcm_frames(&P.decoder, &len);
            P.loaded = MA_TRUE;
            P.last_cursor = 0;
            P.loop_wraps = 0;
            P.stop_after_ramp = MA_FALSE;
            emit("loaded", "\"path\":\"%s\",\"frames\":%llu", path, (unsigned long long)len);
        } else {
            emit("error", "\"detail\":\"decode failed\",\"path\":\"%s\"", path);
        }
        return 0;
    }

    if (strcmp(cmd, "play") == 0) {
        if (!P.loaded) {
            emit("error", "\"detail\":\"play without load\"");
            return 0;
        }
        double fade_in = 500.0;
        json_number(line, "fadeInMs", &fade_in);
        int fade_ms = (int)fade_in;
        if (fade_ms < 0) fade_ms = 0;

        /* Cancel in-flight fade-out (PC-105 fade-cancel). */
        float resume_target = P.volume_set ? P.last_amplitude : 0.2f;
        P.stop_after_ramp = MA_FALSE;
        P.pending_stopped = MA_FALSE;
        P.gain = 0.0f;
        set_ramp_to(resume_target, fade_ms < 1 ? 1 : fade_ms);
        if (fade_ms == 0) {
            P.gain = resume_target;
            P.ramp_per_frame = 0.0f;
        }
        P.playing = MA_TRUE;
        emit("playing", "\"fadeInMs\":%d,\"targetGain\":%.6f", fade_ms, P.target_gain);
        return 0;
    }

    if (strcmp(cmd, "volume") == 0) {
        double amp = 0.0;
        double ramp = 100.0;
        if (!json_number(line, "amplitude", &amp)) {
            emit("error", "\"detail\":\"volume requires amplitude\"");
            return 0;
        }
        json_number(line, "rampMs", &ramp);
        int ramp_ms = (int)ramp;
        if (ramp_ms < 0) ramp_ms = 0;
        float a = clamp_amplitude((float)amp);
        P.last_amplitude = a;
        P.volume_set = MA_TRUE;
        /* Preserve target for subsequent play fade-ins. */
        if (!P.playing) {
            P.target_gain = a;
            P.gain = a;
            P.ramp_per_frame = 0.0f;
        } else {
            set_ramp_to(a, ramp_ms < 1 ? 1 : ramp_ms);
            if (ramp_ms == 0) {
                P.gain = a;
                P.ramp_per_frame = 0.0f;
            }
        }
        emit("volume", "\"amplitude\":%.6f,\"rampMs\":%d", a, ramp_ms);
        return 0;
    }

    if (strcmp(cmd, "fadeout") == 0) {
        double ms_d = 400.0;
        json_number(line, "ms", &ms_d);
        int ms = (int)ms_d;
        if (ms < 0) ms = 0;
        emit("fadeout", "\"ms\":%d", ms);
        if (!P.playing) {
            P.gain = 0.0f;
            P.target_gain = 0.0f;
            P.stop_after_ramp = MA_FALSE;
            P.pending_stopped = MA_FALSE;
            emit("stopped", "\"framesRendered\":%llu,\"loopWraps\":%llu",
                 (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
            return 0;
        }
        if (ms == 0) {
            P.gain = 0.0f;
            P.target_gain = 0.0f;
            P.ramp_per_frame = 0.0f;
            P.playing = MA_FALSE;
            P.stop_after_ramp = MA_FALSE;
            P.pending_stopped = MA_FALSE;
            emit("stopped", "\"framesRendered\":%llu,\"loopWraps\":%llu",
                 (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
            return 0;
        }
        /* Non-blocking: main loop emits "stopped" when the ramp finishes so
         * a concurrent play can cancel the fade (PC-105). */
        P.stop_after_ramp = MA_TRUE;
        P.pending_stopped = MA_FALSE;
        set_ramp_to(0.0f, ms);
        return 0;
    }

    if (strcmp(cmd, "quit") == 0) {
        return 1; /* want exit */
    }

    if (strcmp(cmd, "stats") == 0) {
        emit("stats", "\"framesRendered\":%llu,\"loopWraps\":%llu,\"gain\":%.6f,\"playing\":%s",
             (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps, P.gain,
             P.playing ? "true" : "false");
        return 0;
    }

    emit("error", "\"detail\":\"unknown cmd\",\"cmd\":\"%s\"", cmd);
    return 0;
}

int main(int argc, char** argv) {
    g_t0 = now_ms();
    ma_bool32 use_null = MA_FALSE;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--null") == 0) use_null = MA_TRUE;
    }

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
        ma_context_uninit(&context);
        return 1;
    }
    P.sample_rate = device.sampleRate;
    ma_device_start(&device);
    emit("ready", "\"backend\":\"%s\",\"sampleRate\":%u",
         ma_get_backend_name(context.backend), device.sampleRate);

    char line[2048];
    ma_bool32 want_exit = MA_FALSE;
    ma_bool32 stdin_open = MA_TRUE;

    while (!want_exit && stdin_open) {
        if (P.pending_stopped) {
            P.pending_stopped = MA_FALSE;
            emit("stopped", "\"framesRendered\":%llu,\"loopWraps\":%llu",
                 (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
        }

#if defined(_WIN32)
        /* Peek stdin readiness; fall back to short sleep while fading. */
        HANDLE hIn = GetStdHandle(STD_INPUT_HANDLE);
        DWORD wait = (P.stop_after_ramp || P.playing) ? 10 : 100;
        DWORD wr = WaitForSingleObject(hIn, wait);
        if (wr == WAIT_OBJECT_0) {
            if (!fgets(line, sizeof line, stdin)) {
                stdin_open = MA_FALSE;
                break;
            }
            line[strcspn(line, "\r\n")] = 0;
            if (line[0] != '\0') {
                want_exit = handle_line(line, &device) ? MA_TRUE : MA_FALSE;
            }
        }
#else
        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(STDIN_FILENO, &rfds);
        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = (P.stop_after_ramp || P.playing) ? 10000 : 100000;
        int sel = select(STDIN_FILENO + 1, &rfds, NULL, NULL, &tv);
        if (sel < 0) {
            stdin_open = MA_FALSE;
            break;
        }
        if (sel > 0 && FD_ISSET(STDIN_FILENO, &rfds)) {
            if (!fgets(line, sizeof line, stdin)) {
                stdin_open = MA_FALSE;
                break;
            }
            line[strcspn(line, "\r\n")] = 0;
            if (line[0] != '\0') {
                want_exit = handle_line(line, &device) ? MA_TRUE : MA_FALSE;
            }
        }
#endif
    }

    if (P.pending_stopped) {
        P.pending_stopped = MA_FALSE;
        emit("stopped", "\"framesRendered\":%llu,\"loopWraps\":%llu",
             (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
    }
    emit("exiting", "\"framesRendered\":%llu,\"loopWraps\":%llu",
         (unsigned long long)P.frames_rendered, (unsigned long long)P.loop_wraps);
    ma_device_uninit(&device);
    if (P.loaded) ma_decoder_uninit(&P.decoder);
    ma_context_uninit(&context);
    return 0;
}
