import { exec } from 'child_process';
import os from 'os';

export async function injectKeystrokes(text: string): Promise<void> {
  const platform = os.platform();
  
  if (platform === 'darwin') {
    // macOS: Use AppleScript to send keystrokes to the active application
    // We escape quotes and backslashes for AppleScript
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
      tell application "System Events"
        keystroke "${escapedText}"
        keystroke return
      end tell
    `;
    return new Promise((resolve, reject) => {
      exec(`osascript -e '${script}'`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  } 
  
  else if (platform === 'linux') {
    // Linux: try using xdotool if available
    const escapedText = text.replace(/'/g, "'\\''");
    return new Promise((resolve, reject) => {
      exec(`xdotool type '${escapedText}' && xdotool key Return`, (error) => {
        if (error) reject(new Error("xdotool not found or failed."));
        else resolve();
      });
    });
  }
  
  else {
    throw new Error(`OS-level keystroke injection not supported on ${platform}. Please use the PTY wrapper (openpeers run -- <command>).`);
  }
}
