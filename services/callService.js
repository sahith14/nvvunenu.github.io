// =====================================================================
// callService.js — lean WebRTC peer for 1:1 video/audio/screen share.
// Signaling is pluggable via sendSignal() / onSignalReceived() placeholders.
// Wire these to Firestore, Socket.IO, or any transport of your choice.
// =====================================================================

const DEFAULT_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export function createCall({ iceServers = DEFAULT_ICE, sendSignal, onStream, onStateChange } = {}) {
  let pc         = null;
  let localStream = null;
  let screenStream = null;
  let remoteStream = null;
  let started    = false;
  let polite     = false;     // for glare handling
  let makingOffer = false;
  let ignoreOffer = false;

  function state(s) { onStateChange?.(s); }

  function ensurePC() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers });
    remoteStream = new MediaStream();
    onStream?.({ kind: "remote", stream: remoteStream });

    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach(t => remoteStream.addTrack(t));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignal?.({ type: "ice", candidate: ev.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      state(pc.connectionState); // new | connecting | connected | disconnected | failed | closed
    };

    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        sendSignal?.({ type: "sdp", sdp: pc.localDescription });
      } catch (e) {
        console.warn("[call] negotiation error", e);
      } finally {
        makingOffer = false;
      }
    };

    return pc;
  }

  async function startLocal({ video = true, audio = true } = {}) {
    localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
    onStream?.({ kind: "local", stream: localStream });
    ensurePC();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    return localStream;
  }

  async function startCall(opts = {}) {
    polite = false;
    started = true;
    state("connecting");
    await startLocal(opts);
    // negotiationneeded will fire & send offer.
  }

  async function acceptCall(opts = {}) {
    polite = true;
    started = true;
    state("connecting");
    await startLocal(opts);
  }

  // ----- SCREEN SHARE -----
  async function startScreenShare() {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    ensurePC();
    const vTrack = screenStream.getVideoTracks()[0];
    // Replace outgoing video track if already present; else add.
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(vTrack);
    else pc.addTrack(vTrack, screenStream);
    vTrack.onended = () => stopScreenShare();
    return screenStream;
  }

  async function stopScreenShare() {
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    const sender = pc?.getSenders().find(s => s.track?.kind === "video");
    const camTrack = localStream?.getVideoTracks()[0];
    if (sender && camTrack) await sender.replaceTrack(camTrack);
  }

  // ----- SIGNALING INTAKE (call this when you receive a signal) -----
  async function onSignalReceived(data) {
    ensurePC();
    try {
      if (data.type === "sdp") {
        const desc = data.sdp;
        const offerCollision = desc.type === "offer" && (makingOffer || pc.signalingState !== "stable");
        ignoreOffer = !polite && offerCollision;
        if (ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          sendSignal?.({ type: "sdp", sdp: pc.localDescription });
        }
      } else if (data.type === "ice" && data.candidate) {
        try { await pc.addIceCandidate(data.candidate); }
        catch (e) { if (!ignoreOffer) throw e; }
      }
    } catch (e) {
      console.warn("[call] signal error", e);
    }
  }

  // ----- CONTROLS -----
  function toggleMute() {
    const t = localStream?.getAudioTracks()[0]; if (!t) return false;
    t.enabled = !t.enabled; return !t.enabled;   // returns isMuted
  }
  function toggleCamera() {
    const t = localStream?.getVideoTracks()[0]; if (!t) return false;
    t.enabled = !t.enabled; return !t.enabled;
  }

  function endCall() {
    started = false;
    try { localStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { screenStream?.getTracks().forEach(t => t.stop()); } catch {}
    try { pc?.getSenders().forEach(s => { try { s.track?.stop(); } catch {} }); } catch {}
    try { pc?.close(); } catch {}
    pc = null; localStream = null; screenStream = null; remoteStream = null;
    state("closed");
  }

  return {
    startCall, acceptCall, endCall,
    startScreenShare, stopScreenShare,
    toggleMute, toggleCamera,
    onSignalReceived,
    get isStarted() { return started; },
    get localStream()  { return localStream; },
    get remoteStream() { return remoteStream; }
  };
}

// =====================================================================
// DEFAULT placeholder signaling hooks — override when wiring to transport.
// =====================================================================
export function sendSignal(data) {
  // Replace with: socket.emit('call:signal', data)  OR
  // Firestore: addDoc(collection(db, 'calls', roomId, 'signaling'), data)
  console.log("[call] sendSignal (placeholder):", data);
}

export function onSignalReceived(/* data */) {
  // Replace with: socket.on('call:signal', handler)  OR
  // onSnapshot(collection(db, 'calls', roomId, 'signaling'), ...)
  console.log("[call] onSignalReceived (placeholder) — no transport wired yet");
}
