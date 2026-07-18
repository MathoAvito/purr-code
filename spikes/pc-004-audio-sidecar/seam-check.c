/*
 * PC-004: sample-exact gaplessness proof.
 *
 * Reads N x file-length frames through the same looping data source the
 * sidecar uses, then verifies every loop iteration is byte-identical to the
 * first — i.e. the wrap inserts no silence and drops no frames. Prints one
 * JSON line.
 *
 * Build: cc -O2 -o seam-check seam-check.c -lm -lpthread -ldl
 */
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_DEVICE_IO
#define MA_NO_GENERATION
#include "vendor/miniaudio.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char** argv) {
    if (argc < 2) { fprintf(stderr, "usage: seam-check <wav> [loops]\n"); return 2; }
    int loops = argc > 2 ? atoi(argv[2]) : 4;

    ma_decoder_config cfg = ma_decoder_config_init(ma_format_f32, 2, 48000);
    ma_decoder dec;
    if (ma_decoder_init_file(argv[1], &cfg, &dec) != MA_SUCCESS) return 1;
    ma_data_source_set_looping(&dec, MA_TRUE);

    ma_uint64 len = 0;
    ma_data_source_get_length_in_pcm_frames(&dec, &len);
    size_t frame_bytes = 2 * sizeof(float);
    float* first = malloc(len * frame_bytes);
    float* buf = malloc(len * frame_bytes);

    /* read in odd-sized chunks so wraps land mid-read (the hard case) */
    ma_uint64 chunk = 4093;
    int mismatched_loops = 0;
    ma_uint64 total_short_reads = 0;

    for (int it = 0; it < loops; it++) {
        float* dst = it == 0 ? first : buf;
        ma_uint64 got = 0;
        while (got < len) {
            ma_uint64 want = len - got < chunk ? len - got : chunk;
            ma_uint64 read = 0;
            ma_data_source_read_pcm_frames(&dec, dst + got * 2, want, &read);
            if (read < want) total_short_reads++;
            if (read == 0) break;
            got += read;
        }
        if (it > 0 && memcmp(first, buf, (size_t)len * frame_bytes) != 0) mismatched_loops++;
    }

    printf("{\"file\":\"%s\",\"framesPerLoop\":%llu,\"loopsCompared\":%d,"
           "\"mismatchedLoops\":%d,\"shortReads\":%llu,\"gapless\":%s}\n",
           argv[1], (unsigned long long)len, loops - 1, mismatched_loops,
           (unsigned long long)total_short_reads,
           (mismatched_loops == 0 && total_short_reads == 0) ? "true" : "false");

    ma_decoder_uninit(&dec);
    free(first);
    free(buf);
    return mismatched_loops == 0 ? 0 : 1;
}
