# 🌬️ Sip & Puff — Assistive HID Mouse Controller

An assistive USB mouse powered by a **pressure sensor** and **Raspberry Pi Pico W**. Gentle sips and puffs translate into precise cursor movements — empowering people with motor disabilities to navigate any computer.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-RP2040-brightgreen)
![USB](https://img.shields.io/badge/protocol-USB%20HID-orange)

---

## ✨ Features

- **Hands-free cursor control** — four-direction mouse movement using breath pressure (sip/puff)
- **Plug-and-play USB HID** — appears as a standard mouse on any OS, no drivers needed
- **Live serial diagnostic output** — CDC serial streams `raw`, `delta`, and `event` data for debugging
- **Web dashboard** — browser-based UI with real-time waveform, gauge, cursor preview, and configuration panel (Web Serial API)
- **Configurable thresholds** — tune soft/hard sensitivity, movement speed, and sensor parameters from the dashboard
- **Built-in demo mode** — test the entire UI without hardware

---

## 🏗️ System Architecture

```
Breath → HX710B Sensor → RP2040 (Classify) → USB HID Report → Cursor Movement
              │                   │
              │                   └──→ CDC Serial → Web Dashboard (optional)
              │
         24-bit ADC
         GPIO 14 (SCK)
         GPIO 15 (DATA)
```

### Event Classification

| Event ID | Name | Delta Condition | Mouse Action |
|----------|------|----------------|--------------|
| `0` | `EVT_IDLE` | \|Δ\| < Soft Threshold | No movement |
| `1` | `EVT_SOFT_PUFF` | Soft ≤ Δ < Hard | → Cursor Right |
| `2` | `EVT_SOFT_SIP` | −Hard < Δ ≤ −Soft | ← Cursor Left |
| `3` | `EVT_HARD_PUFF` | Δ ≥ Hard | ↑ Cursor Up |
| `4` | `EVT_HARD_SIP` | Δ ≤ −Hard | ↓ Cursor Down |

---

## 📦 Hardware Requirements

| Component | Description |
|-----------|-------------|
| **Raspberry Pi Pico W** | RP2040-based microcontroller with USB |
| **HX710B** | 24-bit pressure ADC module |
| **Tubing + Mouthpiece** | Food-safe silicone tubing connected to the sensor's pressure port |
| **USB cable** | Micro-USB to connect Pico to host computer |

### Wiring

| HX710B Pin | Pico Pin |
|-----------|----------|
| SCK | GPIO 14 |
| DOUT (DATA) | GPIO 15 |
| VCC | 3V3 |
| GND | GND |

---

## 🔧 Building the Firmware

### Prerequisites

1. **Pico SDK v2.3.1** — Install the [Raspberry Pi Pico SDK](https://github.com/raspberrypi/pico-sdk)
2. **ARM GCC toolchain** (`arm-none-eabi-gcc` v15.2 Rel1 or compatible)
3. **CMake ≥ 3.13**
4. *(Recommended)* [Raspberry Pi Pico VS Code Extension](https://marketplace.visualstudio.com/items?itemName=raspberry-pi.raspberry-pi-pico) — auto-configures SDK paths

### Build Steps

```bash
# Clone the repo
git clone https://github.com/<your-username>/sandpfwocm.git
cd sandpfwocm

# Create a build directory
mkdir build && cd build

# Configure (set PICO_SDK_PATH if not using the VS Code extension)
cmake -DPICO_BOARD=pico_w ..

# Build
make -j$(nproc)
```

This produces **`sandpfwocm.uf2`** inside the `build/` directory.

### Flashing

1. Hold the **BOOTSEL** button on the Pico W and plug it into USB
2. It mounts as a USB mass-storage drive (`RPI-RP2`)
3. Copy `sandpfwocm.uf2` onto that drive — the Pico reboots automatically
4. The device now appears as:
   - **HID Mouse** — `"Sip-Puff Mouse"`
   - **CDC Serial** — `"Sip-Puff Serial"` (for diagnostics)

---

## 🖥️ Web Dashboard

The `ui/` folder contains a standalone browser-based dashboard. **No build step required** — just open the HTML file.

### Quick Start

```bash
# Option 1: Open directly in your browser
# (navigate to ui/index.html and open it)

# Option 2: Serve locally (any simple HTTP server)
cd ui
python -m http.server 8080
# Then open http://localhost:8080
```

> **Note:** The Web Serial API requires **Chrome** or **Edge** (Chromium-based browsers). Firefox and Safari do not support Web Serial.

### Dashboard Sections

| Section | Description |
|---------|-------------|
| **Dashboard** | Live status cards (connection, baseline, event, delta), pressure gauge, waveform graph, and cursor movement preview |
| **Terminal** | Built-in serial console — connect to the Pico's CDC serial port directly from the browser, replacing PuTTY |
| **Configuration** | Adjust thresholds (soft/hard), movement speed (px/report), sensor timeout, baseline smoothing, and poll interval. Generates a `#define` snippet you can copy back into the firmware |
| **Mapping** | Visual diagram showing how each sip/puff intensity maps to cursor direction |
| **About** | Project overview, tech stack, and system architecture flow |

### Connecting to the Device

1. Plug in your flashed Pico W
2. Open the dashboard in Chrome/Edge
3. Click **"Connect"** in the Terminal section
4. Select the serial port for `"Sip-Puff Serial"` when prompted
5. Live data streams in the terminal and dashboard automatically

### Demo Mode (No Hardware Needed)

Click **"▶ Start Simulation"** in the demo bar below the terminal. Use the **💨 Puff** and **🌬 Sip** buttons to inject simulated events.

---

## 📁 Project Structure

```
sandpfwocm/
├── sandpfwocm.c          # Main firmware — HX710B driver, event classification, HID mouse reports
├── usb_descriptors.c     # TinyUSB USB descriptors (HID mouse + CDC serial composite device)
├── tusb_config.h         # TinyUSB configuration (HID + CDC enabled)
├── CMakeLists.txt        # CMake build config for Pico SDK
├── pico_sdk_import.cmake # Pico SDK CMake helper
├── .gitignore            # Ignores build/ directory
├── ui/
│   ├── index.html        # Web dashboard — single-page app
│   ├── style.css         # Premium dark-mode glassmorphism styles
│   └── app.js            # Dashboard logic — serial, waveform, config, demo
└── build/                # (generated) Build output — .uf2 firmware file
```

---

## ⚙️ Firmware Configuration

Key constants in [`sandpfwocm.c`](sandpfwocm.c):

```c
#define SCK_PIN           14      // HX710B clock pin
#define DATA_PIN          15      // HX710B data pin
#define SOFT_THRESHOLD    20000   // Minimum |delta| for soft sip/puff
#define HARD_THRESHOLD    180000  // Minimum |delta| for hard sip/puff
#define MOVE_STEP         5       // Pixels per HID report
#define HX710B_TIMEOUT_MS 100     // Sensor read timeout (ms)
```

The baseline auto-calibrates on startup and continuously adapts during idle periods using an exponential moving average (`baseline += (raw - baseline) / 32`).

---

## 🔌 Serial Output Format

The firmware continuously outputs to CDC serial:

```
raw=8420156 delta=31644 event=1
raw=8388203 delta=-405 event=0
raw=8185432 delta=-203176 event=4
```

- **`raw`** — Raw 24-bit ADC reading from the HX710B
- **`delta`** — Difference from running baseline (`raw - baseline`)
- **`event`** — Classified event ID (0–4, see table above)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

This project is open source. See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgements

- [Raspberry Pi Pico SDK](https://github.com/raspberrypi/pico-sdk)
- [TinyUSB](https://github.com/hathach/tinyusb) — USB device stack
- [Web Serial API](https://developer.chrome.com/docs/capabilities/serial) — browser-to-device serial communication

---

<p align="center">
  <em>Built with ♥ for accessibility</em>
</p>
