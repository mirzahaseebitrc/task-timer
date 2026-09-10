import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import "./styles.css";

type TimerStatus = "idle" | "running" | "paused" | "finished";

interface SavedSettings {
  taskName: string;
  durationMs: number;
  sound: boolean;
  notifications: boolean;
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const taskNameInput = $("#taskName") as HTMLInputElement;
const hoursInput = $("#hoursInput") as HTMLInputElement;
const minutesInput = $("#minutesInput") as HTMLInputElement;
const secondsInput = $("#secondsInput") as HTMLInputElement;
const soundToggle = $("#soundToggle") as HTMLInputElement;
const notificationToggle = $("#notificationToggle") as HTMLInputElement;
const startButton = $("#startButton") as HTMLButtonElement;
const startButtonText = $("#startButtonText");
const startIcon = $("#startIcon");
const resetButton = $("#resetButton") as HTMLButtonElement;
const timeDisplay = $("#timeDisplay");
const timerState = $("#timerState");
const statusPill = $("#statusPill");
const progressRing = $("#progressRing");
const presetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-minutes]"));

const SETTINGS_KEY = "task-timer.settings.v1";
const DEFAULT_DURATION = 20 * 60 * 1000;

let status: TimerStatus = "idle";
let durationMs = DEFAULT_DURATION;
let remainingMs = DEFAULT_DURATION;
let endAt = 0;
let ticker: number | undefined;
let audioContext: AudioContext | undefined;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function durationFromInputs(): number {
  const hours = clamp(Number(hoursInput.value), 0, 23);
  const minutes = clamp(Number(minutesInput.value), 0, 59);
  const seconds = clamp(Number(secondsInput.value), 0, 59);
  return ((hours * 60 * 60) + (minutes * 60) + seconds) * 1000;
}

function writeDurationInputs(milliseconds: number): void {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  hoursInput.value = String(hours);
  minutesInput.value = String(minutes);
  secondsInput.value = String(seconds);
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

function saveSettings(): void {
  const settings: SavedSettings = {
    taskName: taskNameInput.value.trim(),
    durationMs,
    sound: soundToggle.checked,
    notifications: notificationToggle.checked,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<SavedSettings>;
    if (typeof saved.taskName === "string") taskNameInput.value = saved.taskName;
    if (typeof saved.durationMs === "number" && saved.durationMs > 0) {
      durationMs = saved.durationMs;
      remainingMs = saved.durationMs;
      writeDurationInputs(saved.durationMs);
    }
    if (typeof saved.sound === "boolean") soundToggle.checked = saved.sound;
    if (typeof saved.notifications === "boolean") notificationToggle.checked = saved.notifications;
  } catch {
    localStorage.removeItem(SETTINGS_KEY);
  }
}

function setInputsDisabled(disabled: boolean): void {
  taskNameInput.disabled = disabled;
  hoursInput.disabled = disabled;
  minutesInput.disabled = disabled;
  secondsInput.disabled = disabled;
  presetButtons.forEach((button) => { button.disabled = disabled; });
}

function updatePresetHighlight(): void {
  const minutes = durationMs / 60_000;
  presetButtons.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.minutes) === minutes);
  });
}

function updateUi(): void {
  timeDisplay.textContent = formatTime(remainingMs);
  const elapsedRatio = durationMs > 0 ? 1 - (remainingMs / durationMs) : 0;
  progressRing.style.setProperty("--progress", `${Math.max(0, Math.min(360, elapsedRatio * 360))}deg`);
  progressRing.classList.toggle("paused", status === "paused");
  setInputsDisabled(status === "running" || status === "paused");
  resetButton.disabled = status === "idle";

  statusPill.className = "status-pill";
  startButton.classList.remove("pause-mode");

  if (status === "running") {
    statusPill.textContent = "Running";
    statusPill.classList.add("running");
    timerState.textContent = taskNameInput.value.trim() || "FOCUS TIME";
    startButtonText.textContent = "Pause";
    startIcon.innerHTML = '<path d="M8 6h3v12H8zM14 6h3v12h-3z" />';
    startButton.classList.add("pause-mode");
  } else if (status === "paused") {
    statusPill.textContent = "Paused";
    statusPill.classList.add("paused");
    timerState.textContent = "PAUSED";
    startButtonText.textContent = "Resume";
    startIcon.innerHTML = '<path d="m9 6 9 6-9 6Z" />';
  } else if (status === "finished") {
    statusPill.textContent = "Complete";
    timerState.textContent = "TIME IS UP";
    startButtonText.textContent = "Start Again";
    startIcon.innerHTML = '<path d="m9 6 9 6-9 6Z" />';
  } else {
    statusPill.textContent = "Ready";
    timerState.textContent = "SET YOUR TIME";
    startButtonText.textContent = "Start Timer";
    startIcon.innerHTML = '<path d="m9 6 9 6-9 6Z" />';
  }
}

async function requestNotificationAccess(): Promise<boolean> {
  if (!notificationToggle.checked || !isTauri()) return false;
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

async function scheduleNativeTimer(milliseconds: number): Promise<void> {
  if (!isTauri()) return;
  const permissionGranted = await requestNotificationAccess();
  await invoke("schedule_timer", {
    durationMs: Math.ceil(milliseconds),
    taskName: taskNameInput.value.trim() || "Your timer",
    notify: notificationToggle.checked && permissionGranted,
  });
}

async function cancelNativeTimer(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_timer");
}

function startTicker(): void {
  window.clearInterval(ticker);
  ticker = window.setInterval(() => {
    remainingMs = Math.max(0, endAt - Date.now());
    updateUi();
    if (remainingMs <= 0) completeTimer();
  }, 200);
}

async function beginTimer(): Promise<void> {
  if (status === "idle" || status === "finished") {
    durationMs = durationFromInputs();
    remainingMs = durationMs;
  }

  if (remainingMs <= 0) {
    timerState.textContent = "CHOOSE A DURATION";
    return;
  }

  if (soundToggle.checked) {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
  }

  status = "running";
  endAt = Date.now() + remainingMs;
  saveSettings();
  updateUi();
  startTicker();
  try {
    await scheduleNativeTimer(remainingMs);
  } catch (error) {
    console.error("Could not schedule native timer", error);
  }
}

async function pauseTimer(): Promise<void> {
  remainingMs = Math.max(0, endAt - Date.now());
  status = "paused";
  window.clearInterval(ticker);
  updateUi();
  try {
    await cancelNativeTimer();
  } catch (error) {
    console.error("Could not cancel native timer", error);
  }
}

async function resetTimer(): Promise<void> {
  window.clearInterval(ticker);
  try {
    await cancelNativeTimer();
  } catch (error) {
    console.error("Could not cancel native timer", error);
  }
  status = "idle";
  remainingMs = durationMs;
  writeDurationInputs(durationMs);
  updateUi();
}

function playAlert(): void {
  if (!soundToggle.checked) return;
  audioContext ??= new AudioContext();
  const now = audioContext.currentTime;
  [0, 0.28, 0.56].forEach((offset, index) => {
    const oscillator = audioContext!.createOscillator();
    const gain = audioContext!.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = index === 2 ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
    oscillator.connect(gain).connect(audioContext!.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.22);
  });
}

function completeTimer(): void {
  if (status !== "running") return;
  window.clearInterval(ticker);
  remainingMs = 0;
  status = "finished";
  updateUi();
  playAlert();

  if (!isTauri() && notificationToggle.checked && "Notification" in window) {
    const show = () => new Notification(taskNameInput.value.trim() || "Task Timer", {
      body: "Your timer has finished.",
    });
    if (Notification.permission === "granted") show();
    else if (Notification.permission !== "denied") void Notification.requestPermission().then((permission) => {
      if (permission === "granted") show();
    });
  }
}

function syncDurationFromEditor(): void {
  if (status !== "idle") return;
  durationMs = durationFromInputs();
  remainingMs = durationMs;
  updatePresetHighlight();
  updateUi();
  saveSettings();
}

startButton.addEventListener("click", () => {
  if (status === "running") void pauseTimer();
  else void beginTimer();
});

resetButton.addEventListener("click", () => void resetTimer());

[hoursInput, minutesInput, secondsInput].forEach((input) => {
  input.addEventListener("input", syncDurationFromEditor);
  input.addEventListener("blur", () => {
    const max = Number(input.max);
    input.value = String(clamp(Number(input.value), 0, max));
    syncDurationFromEditor();
  });
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const minutes = Number(button.dataset.minutes);
    durationMs = minutes * 60_000;
    remainingMs = durationMs;
    writeDurationInputs(durationMs);
    updatePresetHighlight();
    updateUi();
    saveSettings();
  });
});

[taskNameInput, soundToggle, notificationToggle].forEach((input) => {
  input.addEventListener("change", saveSettings);
});
taskNameInput.addEventListener("input", () => {
  if (status === "running") timerState.textContent = taskNameInput.value.trim() || "FOCUS TIME";
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && document.activeElement !== taskNameInput) {
    event.preventDefault();
    startButton.click();
  }
});

loadSettings();
writeDurationInputs(durationMs);
updatePresetHighlight();
updateUi();

if (isTauri()) {
  void listen("timer-finished", () => completeTimer());
}
