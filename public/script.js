const ws = new WebSocket(`ws://${location.host}?type=dashboard`);
const peersMap = new Map();
const terminalsMap = new Map();

const statusEl = document.getElementById('connection-status');
const peersListEl = document.getElementById('peer-list');
const activePeersCountEl = document.getElementById('active-peers-count');
const terminalGrid = document.getElementById('terminal-grid');

ws.onopen = () => {
  statusEl.textContent = 'Connected';
  statusEl.className = 'badge connected';
  fetchPeers();
};

ws.onclose = () => {
  statusEl.textContent = 'Disconnected';
  statusEl.className = 'badge disconnected';
};

ws.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'peer_joined') {
      addPeer(msg.peer);
    } else if (msg.type === 'peer_left') {
      removePeer(msg.id);
    } else if (msg.type === 'pty_out') {
      const term = terminalsMap.get(msg.peer_id);
      if (term) {
        term.write(msg.data);
      }
    }
  } catch(e) {
    console.error("Invalid WS message", e);
  }
};

async function fetchPeers() {
  try {
    const res = await fetch('/api/peers');
    const peers = await res.json();
    peers.forEach(addPeer);
  } catch(e) {
    console.error("Failed to fetch peers", e);
  }
}

function addPeer(peer) {
  if (peersMap.has(peer.id)) return;
  peersMap.set(peer.id, peer);
  renderPeerList();
  createTerminal(peer);
}

function removePeer(id) {
  peersMap.delete(id);
  renderPeerList();
  
  // Remove terminal UI
  const termWrapper = document.getElementById(`term-wrap-${id}`);
  if (termWrapper) {
    termWrapper.style.opacity = '0';
    termWrapper.style.transform = 'scale(0.95)';
    setTimeout(() => termWrapper.remove(), 300);
  }
  terminalsMap.delete(id);
}

function renderPeerList() {
  activePeersCountEl.textContent = `${peersMap.size} Active`;
  
  if (peersMap.size === 0) {
    peersListEl.innerHTML = '<div class="empty-state">No peers connected.</div>';
    return;
  }
  
  peersListEl.innerHTML = '';
  peersMap.forEach(peer => {
    const card = document.createElement('div');
    card.className = 'peer-card';
    card.innerHTML = `
      <div class="peer-id">${peer.id.substring(0, 8)}...</div>
      <div class="peer-cwd" title="${peer.cwd}">${peer.cwd.split('/').pop() || peer.cwd}</div>
    `;
    card.onclick = () => {
      document.querySelectorAll('.peer-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const term = document.getElementById(`term-wrap-${peer.id}`);
      if (term) term.scrollIntoView({ behavior: 'smooth' });
    };
    peersListEl.appendChild(card);
  });
}

function createTerminal(peer) {
  const wrapper = document.createElement('div');
  wrapper.className = 'terminal-wrapper';
  wrapper.id = `term-wrap-${peer.id}`;
  wrapper.style.opacity = '0';
  wrapper.style.transform = 'translateY(10px)';
  
  wrapper.innerHTML = `
    <div class="terminal-header">
      <div class="terminal-title">
        <div class="status-dot"></div>
        Peer ${peer.id}
      </div>
    </div>
    <div class="xterm-container" id="xterm-${peer.id}"></div>
    <div class="terminal-input-bar">
      <input type="text" id="input-${peer.id}" placeholder="Send prompt to this agent..." autocomplete="off">
      <button onclick="sendInput('${peer.id}')">Send</button>
    </div>
  `;
  
  terminalGrid.appendChild(wrapper);
  
  // Initialize Xterm
  const term = new Terminal({
    theme: {
      background: '#0b0c0f',
      foreground: '#f0f3f6',
      cursor: '#58a6ff',
      selectionBackground: 'rgba(88, 166, 255, 0.3)'
    },
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 13,
    cursorBlink: true
  });
  
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  
  const container = document.getElementById(`xterm-${peer.id}`);
  term.open(container);
  fitAddon.fit();
  
  terminalsMap.set(peer.id, term);
  
  // Handle manual terminal input
  const inputEl = document.getElementById(`input-${peer.id}`);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendInput(peer.id);
    }
  });

  // Animate in
  setTimeout(() => {
    wrapper.style.opacity = '1';
    wrapper.style.transform = 'translateY(0)';
    fitAddon.fit();
  }, 50);
}

window.sendInput = function(peerId) {
  const inputEl = document.getElementById(`input-${peerId}`);
  const text = inputEl.value;
  if (!text) return;
  
  ws.send(JSON.stringify({
    type: 'pty_in',
    peer_id: peerId,
    data: text + '\n'
  }));
  
  inputEl.value = '';
};

// Handle resize
window.addEventListener('resize', () => {
  terminalsMap.forEach((term, id) => {
    // We would need to keep references to fitAddon to call .fit()
    // but a hacky way is just let Xterm handle its layout or recreate fitaddon
  });
});
