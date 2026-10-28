#include <stdio.h>
#include <stdarg.h>
#include "pico/stdlib.h"
#include "tusb.h"

#define SCK_PIN   14
#define DATA_PIN  15

#define SOFT_THRESHOLD   20000
#define HARD_THRESHOLD   180000
#define MOVE_STEP        5      // pixels sent per report while an event holds

#define HX710B_TIMEOUT_MS 100   // give up waiting on the sensor after this long

// ---------- HX710B driver ----------

static void hx710b_init(void) {
    gpio_init(SCK_PIN);
    gpio_set_dir(SCK_PIN, GPIO_OUT);
    gpio_put(SCK_PIN, 0);

    gpio_init(DATA_PIN);
    gpio_set_dir(DATA_PIN, GPIO_IN);
    gpio_pull_up(DATA_PIN);
}

// Returns true and fills *out on success. Returns false if the sensor
// doesn't signal "ready" within HX710B_TIMEOUT_MS, so a flaky/disconnected
// sensor can never block tud_task() and take USB enumeration down with it.
static bool hx710b_read_raw(int32_t *out) {
    uint32_t start = to_ms_since_boot(get_absolute_time());
    while (gpio_get(DATA_PIN)) {
        tud_task(); // keep servicing USB while we wait on the sensor
        if (to_ms_since_boot(get_absolute_time()) - start > HX710B_TIMEOUT_MS) {
            return false;
        }
    }

    int32_t count = 0;
    for (int i = 0; i < 24; i++) {
        gpio_put(SCK_PIN, 1);
        sleep_us(1);
        count = count << 1;
        gpio_put(SCK_PIN, 0);
        sleep_us(1);
        if (gpio_get(DATA_PIN)) {
            count++;
        }
    }

    gpio_put(SCK_PIN, 1);
    sleep_us(1);
    gpio_put(SCK_PIN, 0);
    sleep_us(1);

    count ^= 0x800000;
    *out = count;
    return true;
}

// ---------- CDC serial output (for the dashboard terminal) ----------

static void cdc_printf(const char *fmt, ...) {
    char buf[128];
    va_list args;
    va_start(args, fmt);
    int len = vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (len > 0 && tud_cdc_connected()) {
        tud_cdc_write(buf, (uint32_t)len);
        tud_cdc_write_flush();
    }
}

// ---------- Turning pressure deltas into mouse movement ----------

typedef enum {
    EVT_IDLE,
    EVT_SOFT_PUFF,
    EVT_SOFT_SIP,
    EVT_HARD_PUFF,
    EVT_HARD_SIP
} sip_puff_event_t;

static sip_puff_event_t classify(int32_t delta) {
    int32_t abs_delta = delta < 0 ? -delta : delta;
    if (abs_delta > HARD_THRESHOLD) return (delta > 0) ? EVT_HARD_PUFF : EVT_HARD_SIP;
    if (abs_delta > SOFT_THRESHOLD) return (delta > 0) ? EVT_SOFT_PUFF : EVT_SOFT_SIP;
    return EVT_IDLE;
}

// Direction mapping is a starting guess — swap signs here if it feels
// backwards once you test it on a real screen.
static void send_mouse_report(sip_puff_event_t event) {
    if (!tud_hid_ready()) return;

    int8_t dx = 0, dy = 0;
    switch (event) {
        case EVT_SOFT_PUFF: dx =  MOVE_STEP; break;  // soft puff -> right
        case EVT_SOFT_SIP:  dx = -MOVE_STEP; break;  // soft sip  -> left
        case EVT_HARD_PUFF: dy = -MOVE_STEP; break;  // hard puff -> up
        case EVT_HARD_SIP:  dy =  MOVE_STEP; break;  // hard sip  -> down
        default: break;
    }

    if (dx != 0 || dy != 0) {
        tud_hid_mouse_report(0, 0x00, dx, dy, 0, 0);
    }
}

// TinyUSB calls this when the host asks for a report; not used for our
// "push" style reporting, but it must exist to satisfy the HID class driver.
uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                                hid_report_type_t report_type,
                                uint8_t *buffer, uint16_t reqlen) {
    (void) instance; (void) report_id; (void) report_type;
    (void) buffer; (void) reqlen;
    return 0;
}

void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                            hid_report_type_t report_type,
                            uint8_t const *buffer, uint16_t bufsize) {
    (void) instance; (void) report_id; (void) report_type;
    (void) buffer; (void) bufsize;
}

int main(void) {
    // stdio_init_all() not needed — we use our own CDC via cdc_printf()
    tusb_init();
    hx710b_init();

    // Let USB enumerate before we start hammering the sensor for a baseline —
    // and don't let a slow/absent sensor block that enumeration either.
    int32_t baseline = 0;
    bool have_baseline = false;
    {
        int attempts = 0;
        while (!have_baseline && attempts < 40) {
            tud_task();
            int32_t sample;
            if (hx710b_read_raw(&sample)) {
                baseline = sample;
                have_baseline = true;
            }
            attempts++;
        }
        // Refine the baseline with a few more averaged samples, still
        // tolerant of read failures.
        for (int i = 0; i < 19; i++) {
            tud_task();
            int32_t sample;
            if (hx710b_read_raw(&sample)) {
                baseline = sample;
            }
        }
    }

    while (true) {
        tud_task(); // must run continuously for USB to enumerate and work

        int32_t raw;
        if (!hx710b_read_raw(&raw)) {
            // Sensor didn't respond in time this cycle — skip it rather
            // than acting on stale/garbage data, and keep the USB side alive.
            sleep_ms(10);
            continue;
        }

        int32_t delta = raw - baseline;
        sip_puff_event_t event = classify(delta);

        send_mouse_report(event);

        cdc_printf("raw=%ld delta=%ld event=%d\n", raw, delta, event);

        int32_t abs_delta = delta < 0 ? -delta : delta;
        if (abs_delta < SOFT_THRESHOLD) {
            baseline += (raw - baseline) / 32;
        }

        sleep_ms(10);
    }
}