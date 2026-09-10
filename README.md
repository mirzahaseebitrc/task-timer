# Task Timer

A lightweight, offline countdown timer for Windows, Linux, and macOS. Add a task name, choose a duration, and receive a native notification plus an audible alert when time is up.

## Features

- Task name included in the completion notification
- Custom hours, minutes, and seconds
- 10, 20, 30, and 60-minute presets
- Start, pause, resume, reset, and start-again flow
- Accurate native timer while the window is hidden
- Native desktop notifications
- Built-in alert sound (no external audio file)
- Local persistence for the last task, duration, and preferences
- System tray support; closing the window hides it instead of ending the timer
- Fully offline; no account, server, or database

## Development prerequisites

- Node.js 20 or newer
- Rust stable toolchain
- Platform-specific Tauri prerequisites: <https://v2.tauri.app/start/prerequisites/>

## Run locally

```bash
npm install
npm run tauri dev
```

## Create installers

Run the build on each target operating system:

```bash
npm run tauri build
```

Typical outputs:

- Windows: `src-tauri/target/release/bundle/nsis/*-setup.exe`
- Ubuntu/Debian: `src-tauri/target/release/bundle/deb/*.deb`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`

Windows notifications work from an installed build. For public distribution without an “Unknown publisher” warning, sign the Windows installer with a code-signing certificate.

## Build without owning every operating system

The included `.github/workflows/build-installers.yml` workflow builds all three installers on native GitHub-hosted machines. Push the project to GitHub, open **Actions → Build desktop installers → Run workflow**, then download the Windows, Linux, or macOS artifact produced by the workflow.

## Keyboard shortcut

- `Space`: Start, pause, or resume (when the task-name field is not focused)
