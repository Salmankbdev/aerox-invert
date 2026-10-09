# Aerox Monitor

Desktop monitor for the **Inverex Aerox 1.2KW MPPT** solar inverter, talking to it over its
built-in **USB-HID** port. Electron + TypeScript, no framework in the renderer.

---

## 1. Quick start

```bash
npm install
npm run dev          # electron-vite: main + preload + renderer, hot reload
npm run typecheck    # tsc --noEmit against tsconfig.node.json and tsconfig.web.json
npm run build        # production bundles into out/
npm run pack         # build + electron-builder --dir (unpacked Windows app)
npm run dist         # build + NSIS installer into release/
npm run probe        # standalone HID link probe (needs the inverter plugged in)
npm run probe:quick  # same, but only QPIGS / report-write / CRC on
```

**Run `npm run typecheck` and `npm run build` before declaring any task done.**
Both must be clean.

> If `npm run dev` fails with `Error: Electron uninstall`, the postinstall that downloads
> the binary was skipped. Fix with:
> `node node_modules/electron/install.js`

---

## 2. What this thing actually is

This is the hard-won hardware knowledge. Do not re-derive it.

### The device

| Item | Value |
| --- | --- |
| Nameplate | INVEREX SOLAR ENERGY, MPPT BASED SOLAR INVERTER, **AEROX 1.2KW** |
| Ratings | 1200 VA / 1200 W, PF 1.0, DC in 12 V / 114 A, AC out 230 VAC 50/60 Hz 5.2 A |
| MPPT | 15 ~ 80 VDC, Voc 102 V, 50 A max |
| USB IDs | **VID `0x0665` PID `0x5161`**, bcdDevice `0x0002` |
| HID | class `HID`, **usage page `0xFF00` / usage `0x01`**, **1 endpoint only: `0x81` interrupt IN — there is no OUT endpoint** |
| USB strings | "INNO TECH" / "USB to Serial", vendor `WCHCH544` |
| Windows instance | `\\?\HID#VID_0665&PID_5161#6&62a014f&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}` |
| Serial (sticker) | `VM92142006600010` |

### Drivers — nothing to install

Windows binds the inbox `input.inf` → service `HidUsb` (driver `10.0.26100.9444`, provider
Microsoft, `CM_PROB_NONE`). **No COM port is created.** Any serial-port approach
(`serialport`, CH340 drivers, etc.) is the wrong tree.

### Who built it

This is a **Voltronic Power** OEM unit — the same family as Axpert King / Voltronic Axpert,
sold under the Inverex brand. The evidence: the manual's fault-code list, the Inverex Axpert
King product, and the `0665:5161` Cypress/WCH USB-HID bridge that Voltronic ships
everywhere. The vendor software ecosystem is **WatchPower / SolarPower**.

### Protocol: PI30

ASCII command/response over the HID link. Two framing rules:

```
host -> device :  <ASCII command> <CRC16_hi> <CRC16_lo> <0x0D>
device -> host :  '(' <payload> <CRC16_hi> <CRC16_lo> <0x0D>
```

**CRC (`crcPI`) is CRC-16/CCITT** — poly `0x1021`, init `0`, non-reflected, evaluated
nibble-at-a-time — **plus a vendor quirk**: if either output byte lands on `0x28` `'('`,
`0x0D`, `0x0A` or `0x00`, that byte is incremented by 1 so it can never be mistaken for a
delimiter.

Verified vectors (see `src/main/protocol/crc.ts`):

| input | CRC |
| --- | --- |
| `(PI30` | `9A 0B` |
| `(ACK` | `39 20` |
| `(NAK` | `73 73` |
| `QPIGS` | `B7 A9` |
| `QPIRI` | `F8 54` |

These are asserted at startup by `crcPIIsValid()` in `src/main/index.ts` — if that fails the
app refuses to start, so a typo here can never masquerade as a dead device.

> Note: an earlier note listed `QDI -> 9E 60`, `QFLAG -> 2F 29`, `QID -> BB 07`. Those were
> wrong (transcription error). The real values are `71 1B`, `98 74`, `D6 EA`. They are now
> locked in `CRC_VECTORS` as regression guards, not as independent oracles.

### Transport — the write path is the open question

Read side is settled. Write side is **not**, and that is the single biggest unknown.

From the vendored hidapi source (`node_modules/node-hid/hidapi/windows/hid.c`):

- **Read**: `hid_read` → `ReadFile` on the interrupt IN pipe. hidapi **strips the leading
  report-ID byte**, so received chunks are already clean payload. Good.
- **Write**: only two control transfers exist, and **there is no OUT endpoint**:
  - `report` → `hid_write` → `WriteFile` on the interrupt pipe. hidapi zero-pads to
    `caps.OutputReportByteLength` and requires the first byte to be the report ID (`0x00`).
  - `feature` → `hid_send_feature_report` → `HidD_SetFeature`.
- `hidapi` also has `hid_send_output_report`, but **node-hid 3.4.0 does not expose it**.
  The only instance methods are `write`, `readSync`, `readTimeout`, `sendFeatureReport`,
  `getFeatureReport`, `setNonBlocking`, `getDeviceInfo`. There is **no
  `getReportDescriptor()`**.
- `nonExclusive` is **macOS-only** in node-hid; ignored on Windows.
- node-hid ships **N-API prebuilds** (`node-napi-v4.node`, including
  `prebuilds/HID-win32-x64`), so **no rebuild is needed for Electron**. `npm run rebuild`
  exists as a fallback only.

A third-party ESP32 reference project (`cleola12/esp32s3-voltronic-usb-pi30`) for the same
VID/PID reports it needs control-transfer (EP0 `SET_REPORT`) writes, **padded in 8-byte
chunks**. Treat that as a hint, not as confirmed fact.

### Known quirks

- **Stale bytes are replayed from the USB buffer** (NUT issue #3410). The device re-sends
  old responses. Always drain/quiet the line before writing a new command.
- **The first query after link-up is reliably lost.** Send a warm-up `QPIGS` and swallow the
  timeout — implemented in `InverterService.warmup()`.
- Half-duplex, one shared buffer: **exactly one command may be in flight**. Enforced by the
  mutex in `InverterService.withLock()`.
- `WatchPower` / `SolarPower` may hold an **exclusive claim** on the HID handle. If probing
  returns nothing, ask the user to close them. *(Still unanswered by the user.)*

---

## 3. Source map

```
src/
  shared/
    types.ts        VENDOR_ID/PRODUCT_ID, DeviceState, Telemetry, Settings, Handshake,
                    SettingKey, SendResult, SetSettingResult, IPC channel names, MODE_LABEL
    settings-spec.ts SETTING_SPECS — every writable parameter, its PI30 command, its
                    allowed values and how its argument is encoded
    api.ts          AeroxApi — the typed surface exposed to the renderer
  main/
    index.ts        BrowserWindow + IPC wiring; runs the CRC self-check before anything else
    service.ts      InverterService — connect lifecycle, handshake matrix, poll loop, mutex
    hid-channel.ts  HidChannel — hotplug monitor, quiet/flush/collect half-duplex request()
    conflicts.ts    detectConflicts() — the vendor apps contending for the HID handle
    protocol/
      crc.ts        crcPI + CRC_VECTORS + crcPIIsValid()
      framing.ts    encodeCommand / toReport / decodeReply / toHex / toPrintable
      setters.ts    buildSettingCommand — validates a value and produces the exact
                    setter string ("POP" + "02", "PCVV" + "14.4")
      parsers.ts    parseQPIGS / parseQPIRI / parseQMOD / parseQPIWS / parseProtocolId /
                    parseFirmware / parseString, WARNING_BITS
  preload/index.ts  contextBridge → window.aerox
  renderer/
    index.html
    src/main.ts     DOM dashboard (no framework)
    src/style.css
scripts/probe.mjs   standalone HID matrix probe, no Electron needed
```

### Layering rules — do not break these

- **All HID I/O lives in the main process.** The renderer is sandboxed
  (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`) and only sees the
  typed `AeroxApi`.
- `node-hid` is marked `external` in `electron.vite.config.ts` — never bundle a native addon.
- `@shared` is aliased in both vite and both tsconfigs. TS 7 removed `baseUrl`, so the
  `paths` entries are relative: `"@shared/*": ["./src/shared/*"]`.

### Lifecycle

```
channel.start()  ──1s poll──>  devices() finds 0665:5161
       │ 'appeared'
       ▼
InverterService.connect()
       │ open(path)
       ▼
handshake()  ── tries writeMode ∈ {report, feature}
       │          × crc ∈ {true, false}
       │          × cmd ∈ {QPI, QPIGS, QMOD}
       │          then falls through to QS/QGS/Q for dialect 'voltronic-qs'
       │        first body that parses as PI30 locks the handshake
       ▼
warmup()    ── QPIGS (swallow timeout), QPIGS again, then QVFW / QID / QMN for identity
       ▼
setConnection('ready') → startPolling()
       │
       ▼
every 1000ms : QPIGS  (primary telemetry)
 every 5s    : QMOD   (operating mode)
 every 10s   : QPIWS  (fault / warning bits)
 every 30s   : QPIRI  (configuration snapshot)
```

Both cadences are **wall-clock deadlines**, not cycle counters, and the next tick is anchored
relatively to the previous deadline - so the poll rate cannot drift by however long the
exchange took, and a dropped poll cannot postpone the Settings snapshot. The three slow
queries are all due on the first cycle, so the dashboard (Settings included) is complete
within a second or two of connect instead of a minute.

5 consecutive *primary* poll failures → `fail()` → close → `absent`/`error`. The hotplug
scanner picks the device back up with exponential backoff (2 s doubling to 30 s), and a real
unplug resets that backoff so a fresh plug-in reconnects immediately. A failing slow query
never counts toward the give-up total; it just pulls its own next attempt forward to 4 s.

While a link is unhealthy (`consecutiveFailures >= 2`) the slow queries are skipped entirely
so every cycle goes to primary telemetry. `conflicts.ts` also polls `tasklist` every 15 s for
WatchPower / SolarPower and surfaces them in state and in the UI banner - Windows lets both
processes hold the HID handle at once, so the vendor app does not fail loudly, it
just interleaves commands and makes replies time out.

---

## 4. Protocol field maps

### `QPIGS` — status string

Reply shape:
`(230.0 50.01 230.0 50.00 0000 0000 000 12.0 26.40 003 050 035.0 00.0 000.0 00.0 0000 00010110 00 00 000.0 1000`

| idx | field |
| --- | --- |
| 0 | grid voltage |
| 1 | grid frequency |
| 2 | output voltage |
| 3 | output frequency |
| 4 | output apparent power (VA) |
| 5 | output active power (W) |
| 6 | load percent |
| 7 | bus voltage |
| 8 | battery voltage |
| 9 | battery charging current |
| 10 | battery capacity |
| 11 | heat sink temperature |
| 12 | PV input current |
| 13 | PV input voltage |
| 14 | battery voltage from SCC |
| 15 | battery discharge current |
| 16 | status flags (8 chars) |
| 17, 18 | reserved / firmware revisions on newer fw |
| 19 | PV input power |
| 20 | status2 flags (3 chars) |

**Status flags are left-aligned, 0-based** — validated against real reply strings
`00010110` and `10010110`. Do not right-align them.

Index 16 (8 chars), as implemented in `parsers.ts`:

```
0 sbuPriorityVersionAdded        4 batteryVoltageSteadyWhileCharging
1 configurationChanged           5 chargingOn
2 sccFirmwareUpdated             6 sccChargingOn
3 loadOn                         7 acChargingOn
```

Index 20 (3 chars):

```
0 chargingToFloat                2 reserved
1 switchedOn
```

*(Index 17/18 are firmware-revision fields that only some firmware revisions emit — the
parser reads index 16 and 20 by position and is defensive about the rest. Check
`parsers.ts` before "fixing" it.)*

### `QPIWS` — warnings/faults

32 bits → 32-entry table, some entries are empty placeholders. The list in
`parsers.ts` is authoritative.

### `QPIRI` — configuration

Sequential parse of **27 fields; older firmware sends 25**. Always keep the raw token
strings for zero-padded enums — e.g. `machineType` arrives as `"01"`, not `1`.

A field past the end of a short reply comes back `null` — an empty cell in the UI. It must
never be fabricated into a string like `unknown(undefined)`; `labelAt()` therefore tests the
index through `pick()` (which maps a missing or non-numeric token to `null`) rather than
testing the raw `num()` result, which reports "no value" as `NaN`.

### Commands in use

`QPI` (protocol ID → returns `(PI30`), `QPIGS`, `QPIRI`, `QMOD`, `QPIWS`, `QVFW`, `QID`,
`QMN`, `QDI`, `QFLAG`. The handshake also tries the legacy `QS` / `QGS` / `Q` for the
older "voltronic-qs" dialect. Writes use `POP` / `PCP` / `PGR` / `PBT` / `PCVV` / `PBFT` /
`PBCV` / `PSDV` / `PBDV` / `MCHGC` / `MUCHGC` / `F` and `PSAVE` - see below.

### Writing settings

The dashboard's **Configuration** panel writes these parameters. The verbs,
argument widths and allowed values come from mpp-solar's `protocols/pi30.py` (same
provenance as the read field maps); the whole table lives in `src/shared/settings-spec.ts`
so the UI and the encoder cannot drift apart:

| key | command | argument | allowed values |
| --- | --- | --- | --- |
| outputSourcePriority | `POP` | `dd` | 00 utility / 01 solar / 02 SBU |
| chargerSourcePriority | `PCP` | `dd` | 00 utility / 01 solar / 02 solar+utility / 03 solar only |
| inputVoltageRange | `PGR` | `dd` | 00 appliance / 01 UPS |
| batteryType | `PBT` | `dd` | 00 AGM / 01 flooded / 02 user (**only these three**) |
| batteryBulkChargeVoltage | `PCVV` | `dd.d` | 12.0 - 14.6 V |
| batteryFloatChargeVoltage | `PBFT` | `dd.d` | 12.0 - 14.6 V |
| batteryRechargeVoltage | `PBCV` | `dd.d` | 11.0 - 12.8 V ladder |
| batteryUnderVoltage | `PSDV` | `dd.d` | 10.0 - 12.0 V |
| batteryRedischargeVoltage | `PBDV` | `dd.d` | 00.0 (full) or 11.0 - 14.5 V |
| maxChargingCurrent | `MCHGC` | `ddd` | 10 - 120 A in tens |
| maxAcChargingCurrent | `MUCHGC` | `ddd` | 2 A, then 10 - 120 A in tens |
| outputFrequency | `F` | none | `50` or `60` |

`command + argument` are concatenated with no separator, so the exact bytes matter:
`POP02`, `PCVV14.4`, `MCHGC060`, `F60`. A wrong width is not close enough - the firmware
answers `(NAK`.

The flow is: renderer sends `{ key, value }` over `IPC.setSetting` →
`buildSettingCommand()` validates the range **and** the allowed-value list in the main
process → the command goes out through the same mutex as the poll loop (half-duplex, one
command in flight) → on `(ACK` the service re-reads `QPIRI` so the panel shows what the
device actually accepted rather than what was requested. `(NAK` is reported inline and in
the console log; an out-of-range value is rejected before anything is sent.

Writes are immediate. Some units only keep them across a power cycle after `PSAVE`, which
the panel exposes as **save to EEPROM**.

> The allowed-value ladders above are the **12 V unit** figures from the protocol notes.
> They have not yet been confirmed against this firmware, so a value the unit dislikes
> shows up as a NAK rather than silently succeeding. The editor also never guesses:
> each control is preselected from the `QPIRI` snapshot, and `batteryType` values the
> inverter reports but `PBT` cannot express (Pylontech, WECO, ...) leave the control blank.

---

## 5. State of the project

### Done

- Device enumeration and driver identification (Windows `Get-PnpDevice` /
  `Get-PnpDeviceProperty`).
- Research establishing Voltronic OEM, the PI30 dialect, and the NUT / `nutdrv_qx` /
  `py-upshid-voltqs` reference implementations.
- Transport semantics confirmed by reading vendored hidapi `windows/hid.c`.
- CRC algorithm identified and **verified against 5 independent vectors**.
- Authoritative field maps taken from mpp-solar's `protocols/pi30.py` and
  `protocol_helpers.py`.
- Full Electron app scaffolded and **typechecking + building clean**:
  main process service, sandboxed preload, dashboard renderer, standalone probe.
- Poll loop hardened: wall-clock scheduling for both the primary and the slow queries,
  immediate priming of Settings, reconnect backoff, and vendor-app conflict detection.

### Blocked / unverified — this is the work

1. **Which write path actually works: `report` or `feature`.**
   Auto-detected by `InverterService.handshake()`, but never confirmed against real
   hardware because the device is unplugged. Run `npm run probe` with the inverter
   connected and record the answer in this README.
2. **Whether CRC is expected on commands by this firmware.** Also auto-detected
   (`crcEnabled`), also unconfirmed.
3. **HID report descriptor is unknown.** node-hid 3.4.0 has no `getReportDescriptor()`.
   `OutputReportByteLength` is therefore unknown — hidapi pads for us, so this is
   probably not blocking, but confirm if writes come back short.
4. **Is WatchPower / SolarPower installed on this machine?** — **Yes.** WatchPower *is*
   installed at `C:\Users\Salman\WatchPower` and was observed **running** (PID 1476) during
   diagnosis on 2026-10-09. It is the prime suspect for an unstable or silent link. Close it
   before probing; the app now detects it and warns in the UI. Still unconfirmed: whether it
   holds the handle exclusively or merely interleaves traffic.
5. **Live validation of every parser** — QPIGS field alignment, QPIWS bit table, QPIRI
   25-vs-27 field split — has only been checked against captured strings, never against
   a running unit.

### Expected next steps, in order

1. **User says "im connected".** Do not probe before that — the physical link is the
   user's to establish.
2. Run `npm run probe` and paste the matrix into this README under a new
   `## Link results` section: write mode, CRC on/off, which commands answered, first
   64 bytes of a real `QPIGS` reply.
3. If the probe answers nothing: check Task Manager for WatchPower/SolarPower, try a
   different USB cable/port, retry. Do not start rewriting the transport.
4. Once the link works, run `npm run dev` and verify the dashboard fills in — telemetry
   tiles, status flags, settings table, mode, warnings. The Configuration panel should be
   populated within a second or two of connect (QPIRI is primed on the first poll cycle),
   not a minute later.
5. Validate parsers against the real reply strings and fix `parsers.ts` where the
   captured data disagrees. Update the field maps in this README if the firmware turns
   out to place a field differently.
6. Only after all of the above: consider the 8-byte chunked-padded write and
   `hid_send_output_report` (would need a node-hid upgrade or a native shim) as
   fallbacks if the standard two paths fail.

### Hardening notes

- A throw from any `state` / `log` listener is caught at the emit site in `service.ts` and
  `hid-channel.ts`. Nothing a listener does can unwind into the poll loop, and the hotplug
  scanner runs inside `guard()` because an exception escaping a timer reaches
  `process.on('uncaughtException')`, which exits the app.
- The console refuses commands longer than 64 characters before they reach the device.
- A timeout, a garbage frame or an empty reply costs one poll cycle; only five
  *consecutive* primary failures are treated as a lost link.

### Known-unknowns worth keeping visible

- QPIGS index 17/18 (firmware revision fields) are parsed defensively and their
  presence varies by firmware.
- `statusMode()` heuristics were removed — the real mode comes from `QMOD` only. Don't
  reintroduce a guess from the status flags.
- The dashboard's PV power bar uses a **700 W full-scale** assumption and the AC voltage
  bar uses **250 V**. These are UI constants, not protocol facts.

---

## 6. Conventions

- TypeScript strict, ESM source, bundled by electron-vite. `"type": "commonjs"` in
  `package.json` (electron-vite emits CJS for main/preload).
- No comments in new code unless the *why* is non-obvious (CRC quirk, HID quirks). The
  protocol files are the exception — they document hardware behaviour.
- No framework in the renderer. Plain DOM, `data-*` selectors, one `renderState()`.
- Log lines carry a `kind`: `tx` | `rx` | `err` | `sys` | `info`.
- Everything the renderer can ask for goes through `AeroxApi`. Adding a channel means
  touching `shared/types.ts` (the `IPC` const), `main/index.ts` and `preload/index.ts`
  together.
