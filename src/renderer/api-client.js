/**
 * Remote Care Monitor Web API Client (Raspberry Pi Edition)
 * Provides the `window.remoteCare` interface to match the Electron preload bridge,
 * allowing the existing UI to run smoothly in standard web browsers over LAN/Wi-Fi.
 */
(() => {
  const updateListeners = new Set();
  const appControlListeners = new Set();
  let eventSource = null;
  let eventSourceToken = null;

  async function request(endpoint, payload = {}) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Server error occurred.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function connectEvents(token) {
    if (!token) return;
    if (eventSource && eventSourceToken === token) return;

    eventSource?.close();
    eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    eventSourceToken = token;

    eventSource.addEventListener('monitor-update', (event) => {
      try {
        const payload = JSON.parse(event.data);
        for (const listener of updateListeners) {
          try {
            listener(payload);
          } catch (err) {
            console.error('Error in monitor-update listener:', err);
          }
        }

        // Web Notification API integration for browser
        if (payload?.type === 'notification' && 'Notification' in window && Notification.permission === 'granted') {
          const n = payload.event;
          new Notification(n.title || 'Remote Care Monitor', {
            body: n.body,
            icon: '/assets/icon.png'
          });
        }
      } catch (err) {
        console.error('Error parsing SSE event:', err);
      }
    });

    eventSource.addEventListener('app-control', (event) => {
      try {
        const payload = JSON.parse(event.data);
        for (const listener of appControlListeners) {
          try {
            listener(payload);
          } catch (err) {
            console.error('Error in app-control listener:', err);
          }
        }
      } catch (err) {
        console.error('Error parsing app-control SSE event:', err);
      }
    });

    eventSource.onerror = () => {
      // EventSource automatically retries connection
    };
  }

  function disconnectEvents() {
    eventSource?.close();
    eventSource = null;
    eventSourceToken = null;
  }

  window.remoteCare = {
    getSetupState: () => request('/api/setup-state'),
    setupAdmin: (payload) => request('/api/setup-admin', payload),
    login: (payload) => request('/api/login', payload),
    connectEvents,
    disconnectEvents,
    logout: (token) => request('/api/logout', { token }),
    getDashboard: (token) => request('/api/dashboard', { token }),
    getCheckHistory: (token, filters) => request('/api/history-list', { token, filters }),

    exportMonthlyReport: async (token, month) => {
      const result = await request('/api/history-export-monthly-report', { token, month });
      if (result.csv) {
        const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `Remote Care Monitor report ${month}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
      }
      return { cancelled: false, rowCount: result.rowCount };
    },

    testNotification: async (token) => {
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {}
      }
      return request('/api/notification-test', { token });
    },

    getNetworkAdapters: (token) => request('/api/network-adapters', { token }),
    getDockerContainers: (token) => request('/api/docker-containers', { token }),
    saveTarget: (token, target) => request('/api/target-save', { token, target }),
    deleteTarget: (token, targetId) => request('/api/target-delete', { token, targetId }),
    runTarget: (token, targetId) => request('/api/target-run', { token, targetId }),
    acknowledgeIncident: (token, incidentId) => request('/api/incident-acknowledge', { token, incidentId }),
    listUsers: (token) => request('/api/users-list', { token }),
    createViewer: (token, user) => request('/api/viewer-create', { token, user }),
    setViewerActive: (token, userId, active) => request('/api/viewer-set-active', { token, userId, active }),
    resetViewerPassword: (token, userId, password) => request('/api/viewer-reset-password', { token, userId, password }),
    changePassword: (token, currentPassword, newPassword) => request('/api/user-change-password', { token, currentPassword, newPassword }),
    updateProfile: (token, profile) => request('/api/user-update-profile', { token, profile }),
    updateViewer: (token, userId, updates) => request('/api/viewer-update', { token, userId, updates }),
    getAppSettings: (token) => request('/api/app-settings', { token }),
    saveAppSettings: (token, settings) => request('/api/app-settings-save', { token, settings }),
    getAppControlState: (token) => request('/api/app-control-state', { token }),
    quitWithPassword: (token, password, source) => request('/api/quit-with-password', { token, password, source }),
    cancelProtectedQuit: (token) => request('/api/cancel-protected-quit', { token }),
    getAppInfo: (token) => request('/api/app-info', { token }),
    getPiDiagnostics: (token) => request('/api/pi-diagnostics', { token }),

    onUpdate: (listener) => {
      updateListeners.add(listener);
      return () => updateListeners.delete(listener);
    },

    onAppControl: (listener) => {
      appControlListeners.add(listener);
      return () => appControlListeners.delete(listener);
    }
  };
})();
