// =======================================================
// space.js — Enhanced Couple Space with Advanced Features
// =======================================================

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, query, orderBy, deleteDoc,
  getDocs, arrayUnion, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "../firebase.js";

// Global variables for media streams and connections
let localStream = null;
let peerConnection = null;
let screenStream = null;
let dataChannel = null;
let currentGame = null;
let musicPlayer = null;
let musicSyncInterval = null;

// Runtime lifecycle registries
const unsubscribers = [];
const intervals = [];
const listeners = [];

// Configuration for screen sharing quality
const qualityPresets = {
  '720p30': { width: 1280, height: 720, frameRate: 30, bitrate: 2500000 },
  '720p60': { width: 1280, height: 720, frameRate: 60, bitrate: 4000000 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30, bitrate: 5000000 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, bitrate: 8000000 },
  '2k30': { width: 2560, height: 1440, frameRate: 30, bitrate: 10000000 },
  '2k60': { width: 2560, height: 1440, frameRate: 60, bitrate: 16000000 },
  '4k30': { width: 3840, height: 2160, frameRate: 30, bitrate: 25000000 },
  '4k60': { width: 3840, height: 2160, frameRate: 60, bitrate: 40000000 }
};

export function render() {
  return `
    <div class="space-container">
      <!-- HEADER -->
      <div class="space-header glass">
        <h2 class="space-title">💞 Couple Space</h2>
        <div class="space-subtitle">Private space for you and your partner</div>
      </div>

      <!-- CREATE & JOIN -->
      <div class="space-init-section">
        <button onclick="createSpace()" class="space-btn create-btn">
          <i class="fas fa-plus"></i> Create New Space
        </button>
        
        <div class="join-section">
          <input id="joinRoomId" placeholder="Enter Room ID" class="join-input">
          <button onclick="joinSpace()" class="space-btn join-btn">
            <i class="fas fa-sign-in-alt"></i> Join Space
          </button>
        </div>
      </div>

      <!-- CURRENT SPACE STATUS -->
      <div id="spaceStatus" class="space-status"></div>

      <!-- SPACE ROOM (Hidden until active) -->
      <div id="spaceRoom" class="space-room hidden">
        <!-- Room content will be loaded here -->
      </div>

      <!-- MODALS -->
      ${renderModals()}
    </div>
  `;
}

export function init() {
  console.log("[Space] init");

  // Defensive cleanup in case init is called repeatedly.
  cleanupRegistries();

  // ✅ START SPACE LOGIC HERE
  loadSpaceRoom(unsubscribers, intervals);

  return function cleanup() {
    console.log("[Space] cleanup");

    // 1️⃣ Stop Firestore listeners
    unsubscribers.forEach(fn => {
      try { fn(); } catch { }
    });

    // 2️⃣ Stop intervals
    intervals.forEach(id => clearInterval(id));

    // 3️⃣ Remove DOM listeners
    listeners.forEach(fn => {
      try { fn(); } catch { }
    });

    cleanupRegistries();

    // 4️⃣ Stop media & RTC
    cleanupSpace();

    console.log("[Space] cleanup done");
  };
}

function cleanupRegistries() {
  unsubscribers.splice(0).forEach(fn => {
    try { fn(); } catch { }
  });
  intervals.splice(0).forEach(id => clearInterval(id));
  listeners.splice(0).forEach(fn => {
    try { fn(); } catch { }
  });
}

function renderModals() {
  return `
    <!-- GAME SELECTION MODAL -->
    <div id="gameModal" class="space-modal hidden">
      <div class="modal-content">
        <h3>🎮 Select Game</h3>
        <div class="game-grid">
          <div class="game-card" onclick="startGame('tictactoe')">
            <div class="game-icon">❌⭕</div>
            <h4>Tic Tac Toe</h4>
            <p>Classic 3x3 game</p>
          </div>
          <div class="game-card" onclick="startGame('chess')">
            <div class="game-icon">♔♛</div>
            <h4>Chess</h4>
            <p>Strategic board game</p>
          </div>
          <div class="game-card" onclick="startGame('connect4')">
            <div class="game-icon">🔴🟡</div>
            <h4>Connect 4</h4>
            <p>Drop and connect</p>
          </div>
          <div class="game-card" onclick="startGame('pictionary')">
            <div class="game-icon">🎨✏️</div>
            <h4>Pictionary</h4>
            <p>Draw and guess</p>
          </div>
          <div class="game-card" onclick="startGame('trivia')">
            <div class="game-icon">❓🤔</div>
            <h4>Trivia</h4>
            <p>Test your knowledge</p>
          </div>
          <div class="game-card" onclick="startGame('memory')">
            <div class="game-icon">🧠🃏</div>
            <h4>Memory Match</h4>
            <p>Find matching pairs</p>
          </div>
        </div>
        <button onclick="closeModal('gameModal')" class="modal-close-btn">Close</button>
      </div>
    </div>

    <!-- SCREEN SHARE MODAL -->
    <div id="screenShareModal" class="space-modal hidden">
      <div class="modal-content">
        <h3>🖥️ Screen Sharing</h3>
        
        <div class="quality-presets">
          <h4>Quality Presets</h4>
          <div class="preset-grid">
            <button class="preset-btn" onclick="selectPreset('720p30')">
              720p @ 30fps
              <span>2.5 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('720p60')">
              720p @ 60fps
              <span>4 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('1080p30')">
              1080p @ 30fps
              <span>5 Mbps</span>
            </button>
            <button class="preset-btn active" onclick="selectPreset('1080p60')">
              1080p @ 60fps
              <span>8 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('2k30')">
              2K @ 30fps
              <span>10 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('2k60')">
              2K @ 60fps
              <span>16 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('4k30')">
              4K @ 30fps
              <span>25 Mbps</span>
            </button>
            <button class="preset-btn" onclick="selectPreset('4k60')">
              4K @ 60fps
              <span>40 Mbps</span>
            </button>
          </div>
        </div>

        <div class="custom-settings">
          <h4>Custom Settings</h4>
          <div class="settings-row">
            <label>Resolution:</label>
            <select id="resolutionSelect">
              <option value="720p">720p</option>
              <option value="1080p" selected>1080p</option>
              <option value="2k">2K (1440p)</option>
              <option value="4k">4K (2160p)</option>
            </select>
          </div>
          <div class="settings-row">
            <label>Frame Rate:</label>
            <select id="frameRateSelect">
              <option value="30">30 fps</option>
              <option value="60" selected>60 fps</option>
              <option value="120">120 fps</option>
            </select>
          </div>
          <div class="settings-row">
            <label>Bitrate (Mbps):</label>
            <input type="range" id="bitrateSlider" min="1" max="50" value="8">
            <span id="bitrateValue">8 Mbps</span>
          </div>
        </div>

        <div class="share-options">
          <h4>What to Share</h4>
          <div class="option-row">
            <button class="share-option active" onclick="selectShareOption('screen')">
              <i class="fas fa-desktop"></i> Entire Screen
            </button>
            <button class="share-option" onclick="selectShareOption('window')">
              <i class="fas fa-window-maximize"></i> Application Window
            </button>
            <button class="share-option" onclick="selectShareOption('tab')">
              <i class="fas fa-tab"></i> Browser Tab
            </button>
          </div>
        </div>

        <div class="modal-buttons">
          <button onclick="startScreenShare()" class="primary-btn">
            <i class="fas fa-broadcast-tower"></i> Start Sharing
          </button>
          <button onclick="closeModal('screenShareModal')" class="secondary-btn">Cancel</button>
        </div>
      </div>
    </div>

    <!-- MUSIC SYNC MODAL -->
    <div id="musicModal" class="space-modal hidden">
      <div class="modal-content">
        <h3>🎵 Sync Music</h3>
        
        <div class="music-sources">
          <h4>Music Source</h4>
          <div class="source-tabs">
            <button class="source-tab active" onclick="switchMusicSource('youtube')">
              <i class="fab fa-youtube"></i> YouTube
            </button>
            <button class="source-tab" onclick="switchMusicSource('spotify')">
              <i class="fab fa-spotify"></i> Spotify
            </button>
            <button class="source-tab" onclick="switchMusicSource('local')">
              <i class="fas fa-file-audio"></i> Local File
            </button>
          </div>

          <div id="youtubePanel" class="source-panel active">
            <input type="text" id="youtubeUrl" placeholder="Paste YouTube URL or search">
            <button onclick="searchYouTube()"><i class="fas fa-search"></i> Search</button>
            <div id="youtubeResults" class="search-results"></div>
          </div>

          <div id="spotifyPanel" class="source-panel hidden">
            <input type="text" id="spotifySearch" placeholder="Search Spotify...">
            <button onclick="searchSpotify()"><i class="fas fa-search"></i> Search</button>
          </div>

          <div id="localPanel" class="source-panel hidden">
            <input type="file" id="musicFile" accept="audio/*">
            <button onclick="uploadLocalMusic()"><i class="fas fa-upload"></i> Upload</button>
          </div>
        </div>

        <div class="player-controls hidden" id="musicControls">
          <div class="now-playing">
            <img id="albumArt" src="" class="album-art">
            <div class="track-info">
              <h4 id="trackTitle">No track playing</h4>
              <p id="trackArtist">Select a track to begin</p>
            </div>
          </div>
          <div class="progress-bar">
            <input type="range" id="musicProgress" min="0" max="100" value="0">
            <div class="time-display">
              <span id="currentTime">0:00</span> / <span id="totalTime">0:00</span>
            </div>
          </div>
          <div class="control-buttons">
            <button onclick="skipBackward()"><i class="fas fa-step-backward"></i></button>
            <button onclick="togglePlay()"><i class="fas fa-play"></i></button>
            <button onclick="skipForward()"><i class="fas fa-step-forward"></i></button>
            <button onclick="toggleMute()"><i class="fas fa-volume-up"></i></button>
            <input type="range" id="volumeSlider" min="0" max="100" value="80">
          </div>
          <div class="sync-controls">
            <label>Sync Delay (ms):</label>
            <input type="number" id="syncDelay" min="0" max="5000" value="100">
            <button onclick="forceResync()">Force Resync</button>
          </div>
        </div>

        <div class="modal-buttons">
          <button onclick="startMusicSync()" class="primary-btn" id="startMusicBtn">
            <i class="fas fa-play-circle"></i> Start Sync
          </button>
          <button onclick="closeModal('musicModal')" class="secondary-btn">Close</button>
        </div>
      </div>
    </div>

    <!-- GAME CONTAINER -->
    <div id="gameContainer" class="game-container hidden">
      <div class="game-header">
        <button onclick="closeGame()" class="game-close"><i class="fas fa-times"></i></button>
        <h3 id="gameTitle">Game</h3>
        <div class="game-scores">
          <span id="player1Score">Player 1: 0</span>
          <span id="player2Score">Player 2: 0</span>
        </div>
      </div>
      <div id="gameBoard" class="game-board"></div>
      <div class="game-chat">
        <div id="gameMessages" class="game-messages"></div>
        <div class="game-input">
          <input id="gameChatInput" placeholder="Chat...">
          <button onclick="sendGameChat()"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    </div>

    <!-- SCREEN SHARE VIEWER -->
    <div id="screenViewer" class="screen-viewer hidden">
      <div class="viewer-header">
        <button onclick="stopScreenShare()" class="viewer-close"><i class="fas fa-times"></i></button>
        <div class="viewer-info">
          <span id="sharerName">Screen Sharing</span>
          <span id="qualityInfo" class="quality-badge">1080p @ 60fps</span>
        </div>
        <div class="viewer-controls">
          <button onclick="toggleFullscreen()"><i class="fas fa-expand"></i></button>
          <button onclick="togglePictureInPicture()"><i class="fas fa-compress"></i></button>
          <button onclick="takeScreenshot()"><i class="fas fa-camera"></i></button>
        </div>
      </div>
      <video id="remoteScreen" autoplay playsinline controls></video>
      <div class="viewer-stats">
        <span id="bitrateDisplay">Bitrate: 0 Mbps</span>
        <span id="fpsDisplay">FPS: 0</span>
        <span id="resolutionDisplay">Resolution: 0x0</span>
      </div>
    </div>
  `;
}

// ============================================
// SPACE MANAGEMENT
// ============================================

async function loadSpaceRoom(unsubscribers = [], intervals = []) {
  if (!auth.currentUser) return;

  const userSnap = await getDoc(doc(db, "users", auth.currentUser.uid));
  if (!userSnap.exists()) return;

  const userData = userSnap.data();
  const partnerId = userData.partnerID;

  if (!partnerId) {
    document.getElementById("spaceStatus").innerHTML = `
      <div class="no-partner-notice">
        <i class="fas fa-user-friends"></i>
        <h3>No Partner Connected</h3>
        <p>You need to have a partner to use Couple Space</p>
        <button onclick="loadPage('partner')" class="primary-btn">
          Find Partner
        </button>
      </div>
    `;
    return;
  }

  const partnerSnap = await getDoc(doc(db, "users", partnerId));
  const partnerData = partnerSnap.data();

  if (userData.activeSpace) {
    window.currentSpaceId = userData.activeSpace;
    showSpaceRoom(userData.activeSpace, partnerData);
  } else {
    showPartnerInvite(partnerData);
  }
}

function showPartnerInvite(partnerData) {
  const statusEl = document.getElementById("spaceStatus");
  statusEl.innerHTML = `
    <div class="partner-invite">
      <img src="${partnerData.avatar || 'https://i.pravatar.cc/150'}" class="partner-avatar">
      <h3>Invite ${partnerData.username || 'Your Partner'}</h3>
      <p>Start a private space with your partner</p>
      <button onclick="createSpaceWithPartner()" class="primary-btn">
        <i class="fas fa-video"></i> Start Space
      </button>
      <button onclick="sendSpaceInvite('${partnerData.uid}')" class="secondary-btn">
        <i class="fas fa-paper-plane"></i> Send Invite
      </button>
    </div>
  `;
}

window.createSpaceWithPartner = async function () {
  const user = auth.currentUser;
  if (!user) return;

  // Create space
  const spaceRef = doc(collection(db, "spaces"));
  const spaceId = spaceRef.id;

  await setDoc(spaceRef, {
    id: spaceId,
    hostId: user.uid,
    partnerId: (await getDoc(doc(db, "users", user.uid))).data().partnerID,
    title: `${user.displayName || 'User'}'s Space`,
    isLive: true,
    createdAt: serverTimestamp(),
    settings: {
      videoQuality: '1080p60',
      audioQuality: 'high',
      chatEnabled: true
    }
  });

  // Add both users as members
  const partnerId = (await getDoc(doc(db, "users", user.uid))).data().partnerID;

  await setDoc(doc(db, "spaces", spaceId, "members", user.uid), {
    uid: user.uid,
    name: user.displayName || 'User',
    avatar: user.photoURL || '',
    role: 'host',
    joinedAt: serverTimestamp()
  });

  if (partnerId) {
    const partnerSnap = await getDoc(doc(db, "users", partnerId));
    const partnerData = partnerSnap.data();

    await setDoc(doc(db, "spaces", spaceId, "members", partnerId), {
      uid: partnerId,
      name: partnerData.username || 'Partner',
      avatar: partnerData.avatar || '',
      role: 'member',
      joinedAt: serverTimestamp()
    });
  }

  // Update user's active space
  await updateDoc(doc(db, "users", user.uid), {
    activeSpace: spaceId
  });

  window.currentSpaceId = spaceId;
  loadSpaceRoom();
};

window.createSpace = async function () {
  const spaceId = Math.random().toString(36).substr(2, 9).toUpperCase();
  window.currentSpaceId = spaceId;

  const spaceRef = doc(db, "spaces", spaceId);
  await setDoc(spaceRef, {
    id: spaceId,
    hostId: auth.currentUser.uid,
    title: 'My Space Room',
    isLive: true,
    createdAt: serverTimestamp(),
    settings: {
      videoQuality: '1080p60',
      audioQuality: 'high',
      chatEnabled: true
    }
  });

  // Add creator as member
  await setDoc(doc(db, "spaces", spaceId, "members", auth.currentUser.uid), {
    uid: auth.currentUser.uid,
    name: auth.currentUser.displayName || 'User',
    avatar: auth.currentUser.photoURL || '',
    role: 'host',
    joinedAt: serverTimestamp()
  });

  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    activeSpace: spaceId
  });

  loadSpaceRoom();
};

window.joinSpace = async function () {
  const spaceId = document.getElementById("joinRoomId")?.value.trim();
  if (!spaceId) return alert("Please enter a Room ID");

  const spaceSnap = await getDoc(doc(db, "spaces", spaceId));
  if (!spaceSnap.exists()) {
    alert("Space not found");
    return;
  }

  const user = auth.currentUser;
  const spaceData = spaceSnap.data();

  // Check if space is full (max 2 for couple space)
  const membersSnap = await getDocs(collection(db, "spaces", spaceId, "members"));
  if (membersSnap.size >= 2 && !membersSnap.docs.find(d => d.id === user.uid)) {
    alert("This space is full");
    return;
  }

  // Add user as member
  await setDoc(doc(db, "spaces", spaceId, "members", user.uid), {
    uid: user.uid,
    name: user.displayName || 'User',
    avatar: user.photoURL || '',
    role: 'member',
    joinedAt: serverTimestamp()
  });

  await updateDoc(doc(db, "users", user.uid), {
    activeSpace: spaceId
  });

  window.currentSpaceId = spaceId;
  loadSpaceRoom();
};

async function showSpaceRoom(spaceId, partnerData) {
  const roomEl = document.getElementById("spaceRoom");
  roomEl.classList.remove("hidden");

  const spaceSnap = await getDoc(doc(db, "spaces", spaceId));
  const spaceData = spaceSnap.data();

  roomEl.innerHTML = `
    <div class="room-main">
      <!-- ROOM HEADER -->
      <div class="room-header glass">
        <div class="room-info">
          <div class="room-title">
            <span class="live-badge"><i class="fas fa-circle"></i> LIVE</span>
            <h3>${spaceData.title || 'Couple Space'}</h3>
          </div>
          <div class="room-id">
            <span>Room ID: <code>${spaceId}</code></span>
            <button onclick="copyRoomId('${spaceId}')" class="copy-btn">
              <i class="fas fa-copy"></i> Copy
            </button>
          </div>
        </div>
        
        <div class="room-members">
          ${await renderMemberList(spaceId)}
        </div>

        <div class="room-actions">
          ${spaceData.hostId === auth.currentUser.uid ? `
            <button onclick="endSpace('${spaceId}')" class="danger-btn">
              <i class="fas fa-power-off"></i> End Space
            </button>
          ` : `
            <button onclick="leaveSpace('${spaceId}')" class="secondary-btn">
              <i class="fas fa-sign-out-alt"></i> Leave
            </button>
          `}
        </div>
      </div>

      <!-- MAIN ACTIVITIES GRID -->
      <div class="activities-grid">
        <!-- GAMES -->
        <div class="activity-section">
          <h4><i class="fas fa-gamepad"></i> Games</h4>
          <div class="activity-buttons">
            <button onclick="openModal('gameModal')" class="activity-btn">
              <i class="fas fa-chess-board"></i> Play Games
            </button>
            <button onclick="startQuickGame('tictactoe')" class="activity-btn">
              <i class="fas fa-times"></i> Tic Tac Toe
            </button>
            <button onclick="startQuickGame('chess')" class="activity-btn">
              <i class="fas fa-chess-king"></i> Chess
            </button>
          </div>
        </div>

        <!-- SCREEN SHARE -->
        <div class="activity-section">
          <h4><i class="fas fa-desktop"></i> Screen Share</h4>
          <div class="activity-buttons">
            <button onclick="openModal('screenShareModal')" class="activity-btn primary">
              <i class="fas fa-broadcast-tower"></i> Share Screen
            </button>
            <button onclick="startPresentation()" class="activity-btn">
              <i class="fas fa-presentation"></i> Presentation Mode
            </button>
            <button onclick="openWhiteboard()" class="activity-btn">
              <i class="fas fa-chalkboard"></i> Whiteboard
            </button>
          </div>
          <div class="quality-options">
            <select id="quickQuality" onchange="updateQuickQuality()">
              <option value="720p30">720p @ 30fps</option>
              <option value="1080p30">1080p @ 30fps</option>
              <option value="1080p60" selected>1080p @ 60fps</option>
              <option value="2k30">2K @ 30fps</option>
            </select>
          </div>
        </div>

        <!-- MUSIC SYNC -->
        <div class="activity-section">
          <h4><i class="fas fa-music"></i> Music Sync</h4>
          <div class="activity-buttons">
            <button onclick="openModal('musicModal')" class="activity-btn">
              <i class="fas fa-sliders-h"></i> Advanced Sync
            </button>
            <button onclick="startQuickMusic()" class="activity-btn">
              <i class="fas fa-play-circle"></i> Quick Play
            </button>
            <button onclick="createPlaylist()" class="activity-btn">
              <i class="fas fa-list"></i> Create Playlist
            </button>
          </div>
          <div id="musicStatus" class="status-text">No music playing</div>
        </div>

        <!-- VIDEO/AUDIO CALL -->
        <div class="activity-section">
          <h4><i class="fas fa-video"></i> Video Call</h4>
          <div class="activity-buttons">
            <button onclick="startVideoCall()" class="activity-btn primary">
              <i class="fas fa-video"></i> Start Video Call
            </button>
            <button onclick="startAudioCall()" class="activity-btn">
              <i class="fas fa-phone"></i> Audio Only
            </button>
            <button onclick="toggleCamera()" class="activity-btn">
              <i class="fas fa-camera"></i> Toggle Camera
            </button>
          </div>
          <div class="video-preview">
            <video id="localVideo" autoplay muted playsinline></video>
          </div>
        </div>
      </div>

      <!-- ROOM CHAT -->
      <div class="room-chat-section">
        <h4><i class="fas fa-comments"></i> Room Chat</h4>
        <div id="roomChat" class="room-chat">
          <div id="roomMessages" class="room-messages"></div>
          <div class="chat-input-group">
            <input id="roomMessageInput" placeholder="Type a message..." 
                   onkeypress="if(event.key === 'Enter') sendRoomMessage()">
            <button onclick="sendRoomMessage()" class="send-btn">
              <i class="fas fa-paper-plane"></i>
            </button>
            <button onclick="toggleEmojiPicker()" class="emoji-btn">
              <i class="fas fa-smile"></i>
            </button>
            <input type="file" id="chatFile" hidden accept="image/*,video/*">
            <button onclick="document.getElementById('chatFile').click()" class="file-btn">
              <i class="fas fa-paperclip"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- ACTIVITY STATUS -->
      <div class="activity-status">
        <h4><i class="fas fa-chart-line"></i> Activity Status</h4>
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">Connection:</span>
            <span id="connectionStatus" class="status-value good">Connected</span>
          </div>
          <div class="status-item">
            <span class="status-label">Latency:</span>
            <span id="latencyStatus" class="status-value">-- ms</span>
          </div>
          <div class="status-item">
            <span class="status-label">Quality:</span>
            <span id="qualityStatus" class="status-value good">Excellent</span>
          </div>
          <div class="status-item">
            <span class="status-label">Uptime:</span>
            <span id="uptimeStatus" class="status-value">00:00:00</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Initialize WebRTC connection
  initializeWebRTC(spaceId);

  // Load room messages
  loadRoomMessages(spaceId);

  // Start monitoring connection
  monitorConnection(spaceId);

  // Start uptime counter
  startUptimeCounter();
}

async function renderMemberList(spaceId) {
  const membersSnap = await getDocs(collection(db, "spaces", spaceId, "members"));
  let html = '';

  membersSnap.forEach(doc => {
    const member = doc.data();
    html += `
      <div class="member-item">
        <img src="${member.avatar || 'https://i.pravatar.cc/150'}" class="member-avatar">
        <span class="member-name">${member.name}</span>
        ${member.role === 'host' ? '<span class="host-badge">👑 Host</span>' : ''}
      </div>
    `;
  });

  return html;
}

// ============================================
// GAME SYSTEM
// ============================================

window.openModal = function (modalId) {
  document.getElementById(modalId)?.classList.remove("hidden");
};

window.closeModal = function (modalId) {
  document.getElementById(modalId)?.classList.add("hidden");
};

window.startGame = async function (gameType) {
  closeModal('gameModal');

  const gameContainer = document.getElementById("gameContainer");
  gameContainer.classList.remove("hidden");

  currentGame = {
    type: gameType,
    players: [auth.currentUser.uid, window.currentPartnerId],
    currentPlayer: auth.currentUser.uid,
    state: {},
    scores: { [auth.currentUser.uid]: 0, [window.currentPartnerId]: 0 }
  };

  document.getElementById("gameTitle").textContent = getGameName(gameType);

  switch (gameType) {
    case 'tictactoe':
      renderTicTacToe();
      break;
    case 'chess':
      renderChess();
      break;
    case 'connect4':
      renderConnect4();
      break;
    case 'pictionary':
      renderPictionary();
      break;
    case 'trivia':
      renderTrivia();
      break;
    case 'memory':
      renderMemoryGame();
      break;
  }

  // Listen for game moves
  listenForGameMoves();
};

window.startQuickGame = function (gameType) {
  startGame(gameType);
};

function getGameName(type) {
  const names = {
    tictactoe: 'Tic Tac Toe',
    chess: 'Chess',
    connect4: 'Connect 4',
    pictionary: 'Pictionary',
    trivia: 'Trivia Challenge',
    memory: 'Memory Match'
  };
  return names[type] || type;
}

function renderTicTacToe() {
  const boardEl = document.getElementById("gameBoard");
  boardEl.innerHTML = '';

  // Create 3x3 grid
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "ttt-cell";
    cell.dataset.index = i;
    cell.onclick = () => makeTTTMove(i);
    boardEl.appendChild(cell);
  }

  boardEl.className = "game-board ttt-board";
}

async function makeTTTMove(index) {
  if (currentGame.currentPlayer !== auth.currentUser.uid) {
    alert("Wait for your turn!");
    return;
  }

  const cell = document.querySelector(`.ttt-cell[data-index="${index}"]`);
  if (cell.textContent) return; // Cell already taken

  cell.textContent = currentGame.players[0] === auth.currentUser.uid ? 'X' : 'O';
  cell.classList.add('taken');

  // Update game state
  currentGame.state.board = currentGame.state.board || Array(9).fill('');
  currentGame.state.board[index] = cell.textContent;

  // Switch player
  currentGame.currentPlayer = currentGame.currentPlayer === auth.currentUser.uid
    ? window.currentPartnerId
    : auth.currentUser.uid;

  // Save move to Firestore
  await saveGameMove({
    type: 'move',
    player: auth.currentUser.uid,
    position: index,
    symbol: cell.textContent
  });

  // Check for win
  checkTTTWin();
}

function checkTTTWin() {
  const board = currentGame?.state?.board;
  if (!board) return;
  const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
    [0, 4, 8], [2, 4, 6] // diagonals
  ];

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      endGame(board[a] === 'X' ? currentGame.players[0] : currentGame.players[1]);
      return;
    }
  }

  if (board.every(cell => cell)) {
    endGame('draw');
  }
}

function renderChess() {
  const boardEl = document.getElementById("gameBoard");
  boardEl.innerHTML = `
    <div class="simple-game-placeholder">
      <h3>♔ Chess</h3>
      <p>Chess board mode is loading soon. Start with another game while we finish the full engine.</p>
      <button class="primary-btn" onclick="startGame('tictactoe')">Play Tic Tac Toe Instead</button>
    </div>
  `;
  boardEl.className = "game-board chess-board";
}

function renderConnect4() {
  const boardEl = document.getElementById("gameBoard");
  currentGame.state.connect4 = Array.from({ length: 6 }, () => Array(7).fill(''));
  currentGame.state.currentDisc = '🔴';
  boardEl.innerHTML = `
    <div class="connect4-controls">
      ${Array.from({ length: 7 }, (_, col) => `<button class="connect4-drop" onclick="dropConnect4Disc(${col})">↓</button>`).join('')}
    </div>
    <div id="connect4Grid" class="connect4-grid"></div>
  `;
  boardEl.className = "game-board connect4-board";
  drawConnect4Board();
}

function renderPictionary() {
  const boardEl = document.getElementById("gameBoard");
  boardEl.innerHTML = `
    <div class="pictionary-container">
      <canvas id="drawingCanvas" width="800" height="600"></canvas>
      <div class="drawing-tools">
        <input type="color" id="brushColor" value="#000000">
        <input type="range" id="brushSize" min="1" max="50" value="5">
        <button onclick="clearCanvas()">Clear</button>
      </div>
      <div class="word-display">
        <h3>Word to draw: <span id="currentWord">Cat</span></h3>
      </div>
    </div>
  `;
  boardEl.className = "game-board pictionary-board";
  setupDrawingCanvas();
}

function renderTrivia() {
  const boardEl = document.getElementById("gameBoard");
  boardEl.innerHTML = `
    <div class="trivia-container">
      <div class="trivia-question" id="triviaQuestion">
        <h3>Question 1</h3>
        <p id="questionText">What is the capital of France?</p>
      </div>
      <div class="trivia-answers" id="triviaAnswers">
        <!-- Answers will be added here -->
      </div>
      <div class="trivia-scores">
        <div>Player 1: <span id="triviaScore1">0</span></div>
        <div>Player 2: <span id="triviaScore2">0</span></div>
      </div>
    </div>
  `;
  boardEl.className = "game-board trivia-board";
  loadTriviaQuestion();
}

function renderMemoryGame() {
  const boardEl = document.getElementById("gameBoard");
  const symbols = ['🌙', '⭐', '☄️', '🪐', '🚀', '👾'];
  const deck = [...symbols, ...symbols].sort(() => Math.random() - 0.5);
  currentGame.state.memory = {
    deck,
    flipped: [],
    matched: []
  };
  boardEl.innerHTML = '<div id="memoryGrid" class="memory-grid"></div>';
  boardEl.className = "game-board memory-board";
  drawMemoryGrid();
}

window.dropConnect4Disc = function (column) {
  const board = currentGame?.state?.connect4;
  if (!board) return;

  for (let row = board.length - 1; row >= 0; row--) {
    if (!board[row][column]) {
      board[row][column] = currentGame.state.currentDisc;
      currentGame.state.currentDisc = currentGame.state.currentDisc === '🔴' ? '🟡' : '🔴';
      drawConnect4Board();
      return;
    }
  }
};

function drawConnect4Board() {
  const grid = document.getElementById('connect4Grid');
  const board = currentGame?.state?.connect4;
  if (!grid || !board) return;

  grid.innerHTML = board
    .map(row => row.map(cell => `<div class="connect4-cell">${cell || ''}</div>`).join(''))
    .join('');
}

function setupDrawingCanvas() {
  const canvas = document.getElementById('drawingCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let isDrawing = false;

  const start = (e) => {
    isDrawing = true;
    draw(e);
  };
  const stop = () => {
    isDrawing = false;
    ctx.beginPath();
  };
  const draw = (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const color = document.getElementById('brushColor')?.value || '#000000';
    const size = Number(document.getElementById('brushSize')?.value || 5);

    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  canvas.onmousedown = start;
  canvas.onmouseup = stop;
  canvas.onmouseleave = stop;
  canvas.onmousemove = draw;
}

window.clearCanvas = function () {
  const canvas = document.getElementById('drawingCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
};

const triviaQuestions = [
  {
    question: 'What is the capital of France?',
    options: ['Madrid', 'Paris', 'Rome', 'Lisbon'],
    answer: 'Paris'
  },
  {
    question: 'Which planet is known as the Red Planet?',
    options: ['Mars', 'Jupiter', 'Venus', 'Mercury'],
    answer: 'Mars'
  },
  {
    question: 'How many continents are there?',
    options: ['5', '6', '7', '8'],
    answer: '7'
  }
];

function loadTriviaQuestion() {
  if (!currentGame.state.trivia) {
    currentGame.state.trivia = { index: 0, score: 0 };
  }

  const trivia = currentGame.state.trivia;
  const q = triviaQuestions[trivia.index % triviaQuestions.length];
  const questionText = document.getElementById('questionText');
  const answersEl = document.getElementById('triviaAnswers');
  const scoreEl = document.getElementById('triviaScore1');
  if (!questionText || !answersEl || !scoreEl) return;

  questionText.textContent = q.question;
  answersEl.innerHTML = q.options
    .map(option => `<button class="trivia-answer" onclick="answerTrivia('${option.replace(/'/g, "\\'")}')">${option}</button>`)
    .join('');
  scoreEl.textContent = String(trivia.score);
}

window.answerTrivia = function (answer) {
  const trivia = currentGame?.state?.trivia;
  if (!trivia) return;
  const q = triviaQuestions[trivia.index % triviaQuestions.length];

  if (answer === q.answer) {
    trivia.score += 1;
  }

  trivia.index += 1;
  loadTriviaQuestion();
};

function drawMemoryGrid() {
  const memoryGrid = document.getElementById('memoryGrid');
  const memory = currentGame?.state?.memory;
  if (!memoryGrid || !memory) return;

  memoryGrid.innerHTML = memory.deck
    .map((symbol, idx) => {
      const isFlipped = memory.flipped.includes(idx) || memory.matched.includes(idx);
      return `<button class="memory-card ${isFlipped ? 'open' : ''}" onclick="flipMemoryCard(${idx})">${isFlipped ? symbol : '?'}</button>`;
    })
    .join('');
}

window.flipMemoryCard = function (index) {
  const memory = currentGame?.state?.memory;
  if (!memory || memory.flipped.includes(index) || memory.matched.includes(index)) return;

  memory.flipped.push(index);
  drawMemoryGrid();

  if (memory.flipped.length === 2) {
    const [a, b] = memory.flipped;
    if (memory.deck[a] === memory.deck[b]) {
      memory.matched.push(a, b);
      memory.flipped = [];
      drawMemoryGrid();
    } else {
      setTimeout(() => {
        memory.flipped = [];
        drawMemoryGrid();
      }, 700);
    }
  }
};

async function saveGameMove(move) {
  if (!window.currentSpaceId) return;

  await addDoc(collection(db, "spaces", window.currentSpaceId, "gameMoves"), {
    ...move,
    timestamp: serverTimestamp(),
    gameId: currentGame?.type
  });
}

function listenForGameMoves() {
  if (!window.currentSpaceId) return;

  const q = query(
    collection(db, "spaces", window.currentSpaceId, "gameMoves"),
    orderBy("timestamp", "desc"),
    limit(50)
  );

  const unsub = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const move = change.doc.data();
        if (move.player !== auth.currentUser.uid) {
          handleOpponentMove(move);
        }
      }
    });
  });
  unsubscribers.push(unsub);
}

function handleOpponentMove(move) {
  if (!currentGame) return;

  switch (currentGame.type) {
    case 'tictactoe':
      const cell = document.querySelector(`.ttt-cell[data-index="${move.position}"]`);
      if (cell && !cell.textContent) {
        cell.textContent = move.symbol;
        cell.classList.add('taken');
        currentGame.state.board = currentGame.state.board || Array(9).fill('');
        currentGame.state.board[move.position] = move.symbol;
        currentGame.currentPlayer = auth.currentUser.uid;
        checkTTTWin();
      }
      break;
    // Handle other game types
  }
}

window.closeGame = function () {
  document.getElementById("gameContainer").classList.add("hidden");
  currentGame = null;
};

function endGame(winner) {
  let message = '';
  if (winner === 'draw') {
    message = "It's a draw!";
  } else {
    message = winner === auth.currentUser.uid ? "You win!" : "You lose!";
  }

  alert(message);

  // Update scores
  if (winner !== 'draw') {
    currentGame.scores[winner] = (currentGame.scores[winner] || 0) + 1;
    updateScoreDisplay();
  }

  // Reset game
  setTimeout(() => {
    if (currentGame) {
      currentGame.state = {};
      renderTicTacToe();
    }
  }, 2000);
}

function updateScoreDisplay() {
  document.getElementById("player1Score").textContent =
    `Player 1: ${currentGame.scores[currentGame.players[0]] || 0}`;
  document.getElementById("player2Score").textContent =
    `Player 2: ${currentGame.scores[currentGame.players[1]] || 0}`;
}

// ============================================
// SCREEN SHARING SYSTEM (Advanced)
// ============================================

window.selectPreset = function (preset) {
  // Update UI
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // Update custom settings
  const presetConfig = qualityPresets[preset];
  document.getElementById('resolutionSelect').value =
    presetConfig.width === 1280 ? '720p' :
      presetConfig.width === 1920 ? '1080p' :
        presetConfig.width === 2560 ? '2k' : '4k';
  document.getElementById('frameRateSelect').value = presetConfig.frameRate;
  document.getElementById('bitrateSlider').value = presetConfig.bitrate / 1000000;
  document.getElementById('bitrateValue').textContent =
    `${presetConfig.bitrate / 1000000} Mbps`;
};

window.selectShareOption = function (option) {
  document.querySelectorAll('.share-option').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  window.selectedShareOption = option;
};

window.startScreenShare = async function () {
  try {
    closeModal('screenShareModal');

    const resolution = document.getElementById('resolutionSelect').value;
    const frameRate = parseInt(document.getElementById('frameRateSelect').value);
    const bitrate = parseInt(document.getElementById('bitrateSlider').value) * 1000000;
    const shareType = window.selectedShareOption || 'screen';

    // Get constraints based on selection
    const constraints = {
      video: {
        width: {
          ideal: resolution === '720p' ? 1280 :
            resolution === '1080p' ? 1920 :
              resolution === '2k' ? 2560 : 3840
        },
        height: {
          ideal: resolution === '720p' ? 720 :
            resolution === '1080p' ? 1080 :
              resolution === '2k' ? 1440 : 2160
        },
        frameRate: { ideal: frameRate, max: frameRate },
        cursor: 'always'
      },
      audio: false
    };

    // Add share type
    if (shareType === 'screen') {
      constraints.video.displaySurface = 'monitor';
    } else if (shareType === 'window') {
      constraints.video.displaySurface = 'window';
    } else if (shareType === 'tab') {
      constraints.video.displaySurface = 'browser';
    }

    // Request screen share
    screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);

    // Configure encoder settings
    const videoTrack = screenStream.getVideoTracks()[0];
    const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');

    if (sender && videoTrack) {
      const params = sender.getParameters();
      params.encodings = [{
        rid: 'high',
        active: true,
        maxBitrate: bitrate,
        scaleResolutionDownBy: 1.0,
        maxFramerate: frameRate
      }];
      await sender.setParameters(params);
    }

    // Update UI
    showSharingUI();

    // Send screen stream to partner
    if (peerConnection) {
      const screenSender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (screenSender) {
        screenSender.replaceTrack(videoTrack);
      } else {
        peerConnection.addTrack(videoTrack, screenStream);
      }
    }

    // Listen for stop sharing
    videoTrack.onended = () => {
      stopScreenShare();
    };

  } catch (error) {
    console.error("Screen sharing error:", error);
    alert("Failed to start screen sharing: " + error.message);
  }
};

function showSharingUI() {
  document.getElementById("screenViewer").classList.remove("hidden");
  document.getElementById("sharerName").textContent =
    auth.currentUser.displayName || "You";
  document.getElementById("qualityInfo").textContent =
    `${document.getElementById('resolutionSelect').value} @ ${document.getElementById('frameRateSelect').value}fps`;

  // Show local screen preview
  const localVideo = document.getElementById("localVideo");
  if (localVideo) {
    localVideo.srcObject = screenStream;
  }
}

window.stopScreenShare = function () {
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }

  document.getElementById("screenViewer").classList.add("hidden");

  // Restore camera if available
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack && peerConnection) {
      const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      }
    }
  }
};

window.toggleFullscreen = function () {
  const video = document.getElementById("remoteScreen");
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
};

window.togglePictureInPicture = async function () {
  const video = document.getElementById("remoteScreen");
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  } catch (error) {
    console.error("Picture-in-Picture error:", error);
  }
};

window.takeScreenshot = function () {
  const video = document.getElementById("remoteScreen");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const link = document.createElement("a");
  link.download = `screenshot-${Date.now()}.png`;
  link.href = canvas.toDataURL();
  link.click();
};

// ============================================
// MUSIC SYNC SYSTEM
// ============================================

window.switchMusicSource = function (source) {
  document.querySelectorAll('.source-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  event.target.classList.add('active');

  document.querySelectorAll('.source-panel').forEach(panel => {
    panel.classList.add('hidden');
  });
  document.getElementById(source + 'Panel').classList.remove('hidden');
};

window.startMusicSync = async function () {
  const source = document.querySelector('.source-tab.active').onclick
    .toString().match(/'(\w+)'/)[1];

  let trackUrl = '';
  let trackInfo = {};

  switch (source) {
    case 'youtube':
      trackUrl = document.getElementById('youtubeUrl').value;
      if (!trackUrl) {
        alert("Please enter a YouTube URL or search");
        return;
      }
      trackInfo = await getYouTubeInfo(trackUrl);
      break;
    case 'spotify':
      // Implement Spotify API
      break;
    case 'local':
      const fileInput = document.getElementById('musicFile');
      if (!fileInput.files[0]) {
        alert("Please select a music file");
        return;
      }
      trackUrl = URL.createObjectURL(fileInput.files[0]);
      trackInfo = {
        title: fileInput.files[0].name,
        artist: 'Local File',
        duration: 0
      };
      break;
  }

  if (!trackUrl) return;

  // Show player controls
  document.getElementById("musicControls").classList.remove("hidden");
  document.getElementById("trackTitle").textContent = trackInfo.title;
  document.getElementById("trackArtist").textContent = trackInfo.artist;
  document.getElementById("totalTime").textContent =
    formatTime(trackInfo.duration);

  // Initialize player
  initializeMusicPlayer(trackUrl, trackInfo);

  // Sync with partner
  await syncMusicWithPartner(trackUrl, trackInfo);
};

async function getYouTubeInfo(url) {
  // Simplified - in production, use YouTube Data API
  return {
    title: "YouTube Video",
    artist: "Unknown Artist",
    duration: 180, // 3 minutes in seconds
    thumbnail: ""
  };
}

function initializeMusicPlayer(url, info) {
  if (musicPlayer) {
    musicPlayer.pause();
    musicPlayer = null;
  }

  musicPlayer = new Audio(url);
  musicPlayer.controls = false;

  // Update progress bar
  musicPlayer.addEventListener('timeupdate', () => {
    const progress = (musicPlayer.currentTime / musicPlayer.duration) * 100;
    document.getElementById('musicProgress').value = progress;
    document.getElementById('currentTime').textContent =
      formatTime(musicPlayer.currentTime);
  });

  musicPlayer.addEventListener('ended', () => {
    // Auto-play next track if in playlist
  });

  // Start playing
  musicPlayer.play().catch(e => console.error("Playback error:", e));
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function syncMusicWithPartner(url, info) {
  if (!window.currentSpaceId) return;

  await addDoc(collection(db, "spaces", window.currentSpaceId, "musicSync"), {
    type: 'play',
    url: url,
    title: info.title,
    artist: info.artist,
    duration: info.duration,
    timestamp: serverTimestamp(),
    initiator: auth.currentUser.uid,
    currentTime: musicPlayer?.currentTime || 0,
    playing: musicPlayer?.paused === false
  });

  // Start sync interval
  if (musicSyncInterval) clearInterval(musicSyncInterval);
  musicSyncInterval = setInterval(updateMusicSync, 1000);
}

async function updateMusicSync() {
  if (!window.currentSpaceId || !musicPlayer) return;

  await addDoc(collection(db, "spaces", window.currentSpaceId, "musicSync"), {
    type: 'update',
    currentTime: musicPlayer.currentTime,
    playing: !musicPlayer.paused,
    timestamp: serverTimestamp()
  });
}

function listenForMusicSync() {
  if (!window.currentSpaceId) return;

  const q = query(
    collection(db, "spaces", window.currentSpaceId, "musicSync"),
    orderBy("timestamp", "desc"),
    limit(1)
  );

  const unsub = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const data = change.doc.data();
        if (data.initiator !== auth.currentUser.uid) {
          handleMusicSyncUpdate(data);
        }
      }
    });
  });
  unsubscribers.push(unsub);
}

function handleMusicSyncUpdate(data) {
  if (!musicPlayer) return;

  const syncDelay = parseInt(document.getElementById('syncDelay')?.value || 100);

  switch (data.type) {
    case 'play':
      if (musicPlayer.src !== data.url) {
        initializeMusicPlayer(data.url, {
          title: data.title,
          artist: data.artist,
          duration: data.duration
        });
      }
      setTimeout(() => {
        musicPlayer.currentTime = data.currentTime;
        if (data.playing) musicPlayer.play();
        else musicPlayer.pause();
      }, syncDelay);
      break;

    case 'update':
      const currentTime = musicPlayer.currentTime;
      const diff = Math.abs(currentTime - data.currentTime);

      // If out of sync by more than 0.5 seconds, resync
      if (diff > 0.5) {
        setTimeout(() => {
          musicPlayer.currentTime = data.currentTime;
          if (data.playing !== !musicPlayer.paused) {
            if (data.playing) musicPlayer.play();
            else musicPlayer.pause();
          }
        }, syncDelay);
      }
      break;
  }
}

window.togglePlay = function () {
  if (!musicPlayer) return;

  if (musicPlayer.paused) {
    musicPlayer.play();
  } else {
    musicPlayer.pause();
  }
};

window.toggleMute = function () {
  if (!musicPlayer) return;
  musicPlayer.muted = !musicPlayer.muted;
};

window.forceResync = function () {
  // Force resync with partner
  if (musicPlayer) {
    updateMusicSync();
  }
};

// ============================================
// WEBRTC CONNECTION
// ============================================

async function initializeWebRTC(spaceId) {
  if (peerConnection) {
    peerConnection.close();
  }

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    sdpSemantics: 'unified-plan'
  };

  peerConnection = new RTCPeerConnection(configuration);

  // Add data channel for game moves and chat
  dataChannel = peerConnection.createDataChannel('spaceData');
  setupDataChannel();

  // Get local media (camera)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: true
    });

    // Add local stream to connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Show local video
    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = localStream;
    }
  } catch (error) {
    console.error("Camera access error:", error);
  }

  // Listen for remote stream
  peerConnection.ontrack = (event) => {
    const remoteVideo = document.getElementById("remoteScreen");
    if (remoteVideo && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];

      // Monitor quality
      monitorStreamQuality(event.streams[0]);
    }
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'candidate',
        candidate: event.candidate.toJSON()
      });
    }
  };

  // Handle connection state
  peerConnection.onconnectionstatechange = () => {
    updateConnectionStatus(peerConnection.connectionState);
  };

  // Start signaling
  startSignaling(spaceId);
}

async function startSignaling(spaceId) {
  const signalingRef = collection(db, "spaces", spaceId, "signaling");

  // Listen for offers/answers
  const unsub = onSnapshot(query(signalingRef, orderBy("timestamp", "desc"), limit(20)),
    async (snap) => {
      snap.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const message = change.doc.data();

          if (message.from === auth.currentUser.uid) return;

          switch (message.type) {
            case 'offer':
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.offer)
              );
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);

              await addDoc(signalingRef, {
                type: 'answer',
                answer: { type: answer.type, sdp: answer.sdp },
                from: auth.currentUser.uid,
                to: message.from,
                timestamp: serverTimestamp()
              });
              break;

            case 'answer':
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.answer)
              );
              break;

            case 'candidate':
              try {
                await peerConnection.addIceCandidate(
                  new RTCIceCandidate(message.candidate)
                );
              } catch (e) {
                console.error("Error adding ICE candidate:", e);
              }
              break;
          }
        }
      });
    });

  // Create and send offer if we're the host
  const spaceSnap = await getDoc(doc(db, "spaces", spaceId));
  if (spaceSnap.exists() && spaceSnap.data().hostId === auth.currentUser.uid) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await addDoc(signalingRef, {
      type: 'offer',
      offer: { type: offer.type, sdp: offer.sdp },
      from: auth.currentUser.uid,
      timestamp: serverTimestamp()
    });
  }
  unsubscribers.push(unsub);
}

function sendSignalingMessage(message) {
  if (!window.currentSpaceId) return;

  const data = { ...message, from: auth.currentUser.uid, timestamp: serverTimestamp() };
  if (data.candidate && typeof data.candidate.toJSON === 'function') {
    data.candidate = data.candidate.toJSON();
  }
  addDoc(collection(db, "spaces", window.currentSpaceId, "signaling"), data);
}

function setupDataChannel() {
  dataChannel.onopen = () => {
    console.log("Data channel opened");
  };

  dataChannel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleDataChannelMessage(data);
    } catch (e) {
      console.error("Error parsing data channel message:", e);
    }
  };

  dataChannel.onclose = () => {
    console.log("Data channel closed");
  };
}

function handleDataChannelMessage(data) {
  switch (data.type) {
    case 'chat':
      addChatMessage(data.message, data.sender, false);
      break;
    case 'gameMove':
      handleOpponentMove(data.move);
      break;
    case 'musicControl':
      handleMusicControl(data);
      break;
    case 'drawing':
      handleDrawingData(data);
      break;
  }
}

// ============================================
// CHAT SYSTEM
// ============================================

window.sendRoomMessage = async function () {
  const input = document.getElementById("roomMessageInput");
  const message = input.value.trim();

  if (!message) return;

  // Send via data channel if available
  if (dataChannel?.readyState === 'open') {
    dataChannel.send(JSON.stringify({
      type: 'chat',
      message: message,
      sender: auth.currentUser.uid,
      timestamp: Date.now()
    }));
  }

  // Also save to Firestore for persistence
  await addDoc(collection(db, "spaces", window.currentSpaceId, "messages"), {
    text: message,
    sender: auth.currentUser.uid,
    senderName: auth.currentUser.displayName || 'User',
    timestamp: serverTimestamp(),
    type: 'text'
  });

  input.value = "";
  addChatMessage(message, auth.currentUser.uid, true);
};

function loadRoomMessages(spaceId) {
  const q = query(
    collection(db, "spaces", spaceId, "messages"),
    orderBy("timestamp"),
    limit(100)
  );

  const unsub = onSnapshot(q, (snap) => {
    const messagesEl = document.getElementById("roomMessages");
    messagesEl.innerHTML = '';

    snap.forEach(doc => {
      const msg = doc.data();
      addChatMessage(msg.text, msg.sender, msg.sender === auth.currentUser.uid);
    });

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
  unsubscribers.push(unsub);
}

function addChatMessage(text, senderId, isSelf) {
  const messagesEl = document.getElementById("roomMessages");
  if (!messagesEl) return;

  const messageEl = document.createElement("div");
  messageEl.className = `room-message ${isSelf ? 'self' : 'other'}`;
  messageEl.innerHTML = `
    <div class="message-content">${text}</div>
    <div class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  `;

  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

window.sendGameChat = function () {
  const input = document.getElementById("gameChatInput");
  const message = input.value.trim();

  if (!message || !dataChannel) return;

  dataChannel.send(JSON.stringify({
    type: 'chat',
    message: message,
    sender: auth.currentUser.uid
  }));

  // Add to local UI
  const messagesEl = document.getElementById("gameMessages");
  const messageEl = document.createElement("div");
  messageEl.className = "game-chat-message";
  messageEl.textContent = `${auth.currentUser.displayName || 'You'}: ${message}`;
  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  input.value = "";
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

window.copyRoomId = function (roomId) {
  navigator.clipboard.writeText(roomId).then(() => {
    alert("Room ID copied to clipboard!");
  });
};

window.endSpace = async function (spaceId) {
  if (!confirm("Are you sure you want to end this space for everyone?")) return;

  // Notify all members
  await addDoc(collection(db, "spaces", spaceId, "messages"), {
    text: "Space has been ended by the host",
    sender: 'system',
    timestamp: serverTimestamp(),
    type: 'system'
  });

  // Update user status
  const membersSnap = await getDocs(collection(db, "spaces", spaceId, "members"));
  for (const memberDoc of membersSnap.docs) {
    await updateDoc(doc(db, "users", memberDoc.id), {
      activeSpace: null
    });
  }

  // Delete space
  await deleteDoc(doc(db, "spaces", spaceId));

  // Cleanup
  cleanupSpace();
  loadSpaceRoom();
};

window.leaveSpace = async function (spaceId) {
  if (!confirm("Leave this space?")) return;

  // Remove from members
  await deleteDoc(doc(db, "spaces", spaceId, "members", auth.currentUser.uid));

  // Update user status
  await updateDoc(doc(db, "users", auth.currentUser.uid), {
    activeSpace: null
  });

  // Notify others
  await addDoc(collection(db, "spaces", spaceId, "messages"), {
    text: `${auth.currentUser.displayName || 'A user'} has left the space`,
    sender: 'system',
    timestamp: serverTimestamp(),
    type: 'system'
  });

  // Cleanup
  cleanupSpace();
  loadSpaceRoom();
};

function cleanupSpace() {
  try {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }

    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    if (dataChannel) {
      dataChannel.close();
      dataChannel = null;
    }

    if (musicSyncInterval) {
      clearInterval(musicSyncInterval);
      musicSyncInterval = null;
    }

    if (musicPlayer) {
      musicPlayer.pause();
      musicPlayer = null;
    }

    currentGame = null;
    window.currentSpaceId = null;

  } catch (e) {
    console.warn("cleanup error", e);
  }
}

function updateConnectionStatus(status) {
  const statusEl = document.getElementById("connectionStatus");
  if (!statusEl) return;

  statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  statusEl.className = `status-value ${status === 'connected' ? 'good' :
      status === 'connecting' ? 'warning' : 'error'
    }`;
}

function monitorConnection(spaceId) {
  // Simulate latency monitoring
  const id = setInterval(() => {
    const latencyEl = document.getElementById("latencyStatus");
    if (latencyEl) {
      const latency = Math.floor(Math.random() * 50) + 20;
      latencyEl.textContent = `${latency} ms`;
    }
  }, 5000);
  intervals.push(id);
}

function startUptimeCounter() {
  let seconds = 0;
  const id = setInterval(() => {
    seconds++;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const uptimeEl = document.getElementById("uptimeStatus");
    if (uptimeEl) {
      uptimeEl.textContent =
        `${hours.toString().padStart(2, '0')}:` +
        `${minutes.toString().padStart(2, '0')}:` +
        `${secs.toString().padStart(2, '0')}`;
    }
  }, 1000);
  intervals.push(id);
}

function monitorStreamQuality(stream) {
  const videoTrack = stream.getVideoTracks()[0];

  if (videoTrack && videoTrack.getSettings) {
    const id = setInterval(() => {
      const settings = videoTrack.getSettings();
      const statsEl = document.getElementById("qualityStatus");

      if (statsEl) {
        const width = settings.width || 0;
        const height = settings.height || 0;
        const frameRate = settings.frameRate || 0;

        let quality = 'Unknown';
        if (width >= 3840) quality = '4K';
        else if (width >= 2560) quality = '2K';
        else if (width >= 1920) quality = '1080p';
        else if (width >= 1280) quality = '720p';
        else if (width > 0) quality = 'SD';

        statsEl.textContent = `${quality} @ ${Math.round(frameRate)}fps`;
      }
    }, 3000);
    intervals.push(id);
  }
}

// ============================================
// EXPOSE FUNCTIONS + STUBS FOR MISSING ONES
// ============================================

// These are already defined as window.X earlier:
// createSpace, joinSpace, createSpaceWithPartner,
// endSpace, leaveSpace, copyRoomId, sendRoomMessage,
// sendSpaceInvite, refreshSpace

// Functions that exist as local functions → expose
window.makeTTTMove = makeTTTMove;
window.loadSpaceRoom = loadSpaceRoom;
window.cleanupSpace = cleanupSpace;

// Stubs for functions used in onclick but never defined
window.startGame = window.startGame || function (type) {
  console.log("startGame:", type);
  const container = document.getElementById("gameContainer");
  if (container) container.classList.remove("hidden");
  const board = document.getElementById("gameBoard");
  const title = document.getElementById("gameTitle");
  if (title) title.textContent = type || "Game";
  currentGame = type;
  if (type === "tictactoe") renderTicTacToe();
  else if (type === "connect4") renderConnect4();
  else if (type === "pictionary") renderPictionary();
  else if (type === "trivia") renderTrivia();
  else if (type === "memory") renderMemoryGame();
  else if (board) board.innerHTML = `<p style="text-align:center;opacity:0.6">Coming soon: ${type}</p>`;
};
window.startQuickGame = window.startGame;

window.closeGame = window.closeGame || function () {
  const c = document.getElementById("gameContainer");
  if (c) c.classList.add("hidden");
  currentGame = null;
};

window.dropConnect4Disc = window.dropConnect4Disc || function (col) {
  console.log("Connect4 col:", col);
};

window.answerTrivia = window.answerTrivia || function (idx) {
  console.log("Trivia answer:", idx);
};

window.flipMemoryCard = window.flipMemoryCard || function (idx) {
  console.log("Memory flip:", idx);
};

window.clearCanvas = window.clearCanvas || function () {
  const c = document.getElementById("drawCanvas");
  if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
};

window.sendGameChat = window.sendGameChat || function () {
  console.log("Game chat stub");
};

window.startScreenShare = window.startScreenShare || async function () {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1920, height: 1080, frameRate: 60 }, audio: true });
    const viewer = document.getElementById("screenViewer");
    const video = document.getElementById("remoteScreen");
    if (viewer) viewer.classList.remove("hidden");
    if (video) { video.srcObject = screenStream; video.play(); }
    showSharingUI();
  } catch (e) { console.warn("Screen share cancelled", e); }
};

window.stopScreenShare = window.stopScreenShare || function () {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
  const viewer = document.getElementById("screenViewer");
  if (viewer) viewer.classList.add("hidden");
};

window.toggleFullscreen = window.toggleFullscreen || function () {
  const el = document.getElementById("remoteScreen") || document.getElementById("screenViewer");
  if (!el) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.();
};

window.togglePictureInPicture = window.togglePictureInPicture || async function () {
  const video = document.getElementById("remoteScreen");
  if (!video) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (e) { console.warn("PiP error", e); }
};

window.takeScreenshot = window.takeScreenshot || function () {
  const video = document.getElementById("remoteScreen");
  if (!video) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png"); a.download = "screenshot.png"; a.click();
};

window.selectPreset = window.selectPreset || function (preset) {
  console.log("Quality preset:", preset);
};

window.selectShareOption = window.selectShareOption || function (opt) {
  console.log("Share option:", opt);
};

window.startMusicSync = window.startMusicSync || async function () {
  const url = document.getElementById("musicUrl")?.value;
  if (!url) return alert("Paste a music URL first");
  const info = await getYouTubeInfo(url);
  initializeMusicPlayer(url, info);
  await syncMusicWithPartner(url, info);
};

window.togglePlay = window.togglePlay || function () {
  if (!musicPlayer) return;
  if (musicPlayer.paused) musicPlayer.play(); else musicPlayer.pause();
};

window.toggleMute = window.toggleMute || function () {
  if (!musicPlayer) return;
  musicPlayer.muted = !musicPlayer.muted;
};

window.forceResync = window.forceResync || function () {
  console.log("Force resync");
  if (musicPlayer && window.currentSpaceId) updateMusicSync();
};

window.switchMusicSource = window.switchMusicSource || function (source) {
  console.log("Switch music source:", source);
};

window.searchYouTube = window.searchYouTube || async function (query) {
  console.log("YouTube search:", query);
  return [];
};

window.searchSpotify = window.searchSpotify || async function (query) {
  console.log("Spotify search:", query);
  return [];
};

window.uploadLocalMusic = window.uploadLocalMusic || function () {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "audio/*";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    initializeMusicPlayer(url, { title: file.name, artist: "Local" });
  };
  input.click();
};

window.skipBackward = window.skipBackward || function () {
  if (musicPlayer) musicPlayer.currentTime = Math.max(0, musicPlayer.currentTime - 10);
};

window.skipForward = window.skipForward || function () {
  if (musicPlayer) musicPlayer.currentTime += 10;
};

window.openModal = window.openModal || function (id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
};

window.closeModal = window.closeModal || function (id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("hidden");
};

