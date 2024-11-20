document.addEventListener('DOMContentLoaded', async () => {
  const { firstVisit } = await chrome.storage.local.get('firstVisit');
  
  if (!firstVisit) {
    await chrome.storage.local.set({ firstVisit: true });
    setTimeout(() => {
      document.querySelector('.loading-screen').classList.add('fade-out');
      document.querySelector('.main-content').classList.add('visible');
    }, 1500);
  } else {
    document.querySelector('.loading-screen').style.display = 'none';
    document.querySelector('.main-content').classList.add('visible');
  }

  const result = await chrome.storage.local.get(['preferences', 'PLATFORM_CONFIG']);
  const config = result.PLATFORM_CONFIG || {
    preferredPlatform: 'weidian',
    preferredAgent: 'superbuy',
    preferredCurrency: 'usd'
  };

  document.getElementById('platform-select').value = result.preferences?.platform || config.preferredPlatform;
  document.getElementById('agent-select').value = result.preferences?.agent || config.preferredAgent;
  document.getElementById('currency-select').value = result.preferences?.currency || config.preferredCurrency;

  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      
      button.classList.add('active');
      const tabId = button.dataset.tab;
      const tabContent = document.getElementById(tabId);
      if (tabContent) {
        tabContent.classList.add('active');
      }
    });
  });

  const darkModePreference = await chrome.storage.local.get('darkMode');
  document.getElementById('dark-mode').checked = darkModePreference?.enabled || false;

  await updateCacheStats();

  document.getElementById('save-button').addEventListener('click', async () => {
    const platform = document.getElementById('platform-select').value;
    const agent = document.getElementById('agent-select').value;
    const currency = document.getElementById('currency-select').value;

    await chrome.storage.local.set({
      preferences: { platform, agent, currency },
      PLATFORM_CONFIG: {
        ...config,
        preferredPlatform: platform,
        preferredAgent: agent,
        preferredCurrency: currency
      }
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'preferencesUpdated',
        preferences: { platform, agent, currency }
      });
    }

    window.close();
  });

  document.getElementById('cancel-button').addEventListener('click', () => {
    window.close();
  });

  document.getElementById('export-cache').addEventListener('click', exportCache);
  document.getElementById('import-cache').addEventListener('click', importCache);
  document.getElementById('clear-cache').addEventListener('click', clearCache);

  document.getElementById('dark-mode').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ darkMode: { enabled: e.target.checked } });
    
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'darkModeChanged',
          enabled: e.target.checked
        });
      } catch (error) {
        console.debug('Could not send dark mode message to tab:', tab.id);
      }
    }
  });
});

async function updateCacheStats() {
  const stats = document.querySelector('.cache-stats');
  const result = await chrome.storage.local.get(['productCache', 'cacheMetadata']);
  const cache = result.productCache || {};
  const metadata = result.cacheMetadata || {};

  const items = Object.keys(cache).length;
  const version = metadata.version || '1.0.0';
  const lastCleanup = new Date(metadata.lastCleanup || 0).toLocaleString();

  stats.innerHTML = `
    <div class="cache-stat-item">
      <span>Cached Items</span>
      <span class="cache-stat-value">${items}</span>
    </div>
    <div class="cache-stat-item">
      <span>Cache Version</span>
      <span class="cache-stat-value">${version}</span>
    </div>
    <div class="cache-stat-item">
      <span>Last Cleanup</span>
      <span class="cache-stat-value">${lastCleanup}</span>
    </div>
  `;
}

async function exportCache() {
  const result = await chrome.storage.local.get(['productCache', 'cacheMetadata']);
  const data = {
    version: result.cacheMetadata?.version || '1.0.0',
    timestamp: Date.now(),
    items: result.productCache || {}
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `cache-export-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
}

async function importCache() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  
  input.onchange = async (e) => {
    try {
      const file = e.target.files[0];
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.version || !data.items) {
        throw new Error('Invalid cache file format');
      }
      
      await chrome.storage.local.set({
        productCache: data.items,
        cacheMetadata: {
          version: data.version,
          lastCleanup: Date.now()
        }
      });
      
      await updateCacheStats();
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import cache: ' + error.message);
    }
  };
  
  input.click();
}

async function clearCache() {
  if (confirm('Are you sure you want to clear the cache?')) {
    await chrome.storage.local.remove(['productCache', 'cacheMetadata']);
    await updateCacheStats();
  }
}