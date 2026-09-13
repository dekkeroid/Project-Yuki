/**
 * Formats tool execution events into clean, friendly status text for Yuki's thinking speech bubble.
 */

function getCleanFileName(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function truncateString(str, maxLength = 32) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 1) + '...';
}

export const TOOL_STATUS_MAP = {
  // Web & Search
  web_search: (args) => {
    const q = args?.query || args?.queries || args?.search || args?.text;
    return q ? `Searching the web for "${truncateString(q, 24)}"...` : 'Searching the web...';
  },
  jarvis_web_search: (args) => {
    const q = args?.query || args?.queries || args?.search || args?.text;
    return q ? `Searching the web for "${truncateString(q, 24)}"...` : 'Searching the web...';
  },
  web_scrape: () => 'Reading webpage...',
  jarvis_web_scrape: () => 'Reading webpage...',

  // Vision & Screen
  see_screen: () => 'Looking at your screen...',
  jarvis_see_screen: () => 'Looking at your screen...',
  take_screenshot: () => 'Taking a screenshot...',
  jarvis_take_screenshot: () => 'Taking a screenshot...',
  jarvis_get_image: () => 'Inspecting image...',
  jarvis_analyze_image: () => 'Analyzing image...',
  jarvis_generate_image: () => 'Generating image...',

  // File Operations
  read_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Reading ${fn}...` : 'Reading file...';
  },
  read_file_content: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Reading ${fn}...` : 'Reading file...';
  },
  jarvis_read_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Reading ${fn}...` : 'Reading file...';
  },
  create_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Writing ${fn}...` : 'Creating file...';
  },
  edit_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Updating ${fn}...` : 'Editing file...';
  },
  jarvis_create_or_edit_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Updating ${fn}...` : 'Saving file...';
  },
  jarvis_replace_file_content: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Editing ${fn}...` : 'Editing file...';
  },
  delete_file: (args) => {
    const fn = getCleanFileName(args?.file_path || args?.path || args?.target);
    return fn ? `Deleting ${fn}...` : 'Removing file...';
  },
  list_directory: () => 'Browsing files...',
  jarvis_list_dir_tree: () => 'Browsing directory tree...',
  search_files: (args) => {
    const q = args?.query || args?.pattern;
    return q ? `Searching for "${truncateString(q, 20)}"...` : 'Searching files...';
  },
  jarvis_find_files_by_glob: () => 'Locating matching files...',
  jarvis_grep_files: () => 'Searching codebase...',
  jarvis_query_file_db: () => 'Searching indexed files...',

  // System & Apps
  launch_app: (args) => {
    const app = args?.app_name || args?.name || args?.app;
    return app ? `Launching ${truncateString(app, 22)}...` : 'Launching application...';
  },
  jarvis_launch_app: (args) => {
    const app = args?.app_name || args?.name || args?.app;
    return app ? `Launching ${truncateString(app, 22)}...` : 'Launching application...';
  },
  close_app: (args) => {
    const app = args?.app_name || args?.name || args?.target;
    return app ? `Closing ${truncateString(app, 22)}...` : 'Closing application...';
  },
  jarvis_close_app: (args) => {
    const app = args?.app_name || args?.name || args?.target;
    return app ? `Closing ${truncateString(app, 22)}...` : 'Closing application...';
  },
  set_system_volume: () => 'Adjusting volume...',
  jarvis_system_volume: () => 'Adjusting volume...',
  media_playback_control: () => 'Controlling media playback...',
  jarvis_media_playback_control: () => 'Controlling media playback...',
  control_window: () => 'Arranging window...',
  jarvis_window_control: () => 'Arranging window...',
  get_system_stats: () => 'Checking system performance...',
  jarvis_system_diagnostics: () => 'Running diagnostics...',
  jarvis_network_status: () => 'Checking network status...',
  manage_process: () => 'Managing system process...',
  system_power_control: () => 'Managing system power...',
  keyboard_mouse_input: () => 'Simulating input...',
  jarvis_keyboard_mouse_input: () => 'Simulating input...',

  // Code & Terminal
  run_terminal_command: () => 'Running terminal command...',
  jarvis_run_terminal: () => 'Running command in terminal...',
  run_python_script: () => 'Running Python script...',
  jarvis_run_python: () => 'Executing Python code...',
  jarvis_git_status: () => 'Checking Git repository...',

  // CodeGraph Tools
  codegraph_explore: () => 'Exploring code architecture...',
  codegraph_search: () => 'Searching code symbols...',
  codegraph_node: () => 'Inspecting code definition...',
  codegraph_files: () => 'Scanning indexed files...',
  codegraph_callers: () => 'Tracing callers...',
  codegraph_callees: () => 'Tracing dependencies...',
  codegraph_impact: () => 'Calculating change impact...',
  codegraph_status: () => 'Checking CodeGraph status...',

  // Canvas & UI
  jarvis_html_graphics: () => 'Generating visual canvas...',
  jarvis_html_viewer: () => 'Opening interactive preview...',

  // Automation & Timers
  manage_scheduled_task: () => 'Scheduling task...',
  manage_timer_stopwatch_alarms: () => 'Updating timer / alarm...',

  // Avatar & Persona
  change_avatar_outfit: () => 'Changing outfit...',
  jarvis_change_avatar_outfit: () => 'Changing outfit...',
  update_user_fact: () => 'Remembering that...',
  jarvis_remember_user_fact: () => 'Remembering that...'
};

/**
 * Returns a human-friendly status string for a running tool.
 * @param {string} toolName - The identifier of the tool
 * @param {object} [toolArgs] - Arguments passed to the tool
 * @returns {string} Friendly status description
 */
export function formatToolStatus(toolName, toolArgs = {}) {
  if (!toolName) return 'Thinking...';

  const handler = TOOL_STATUS_MAP[toolName];
  if (handler) {
    try {
      return handler(toolArgs);
    } catch {
      // Fallback if args parsing fails
    }
  }

  // Generic fallback: convert snake_case or namespaced names into clean Title Case
  let cleanName = toolName.replace(/^(jarvis_|mcp__)/i, '');
  cleanName = cleanName.replace(/_/g, ' ').trim();
  cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

  return `${cleanName}...`;
}
