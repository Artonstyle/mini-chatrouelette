// ACHTUNG: VERWENDEN SIE IHRE ECHTE RENDER-URL!
const WS_URL = "wss://mini-chatroulette.onrender.com"; 
const ws = new WebSocket(WS_URL); 

let localStream;
let peerConnection;
let dataChannel;

// DOM-Elemente
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const input = document.getElementById("chatInput");
const sendBtn = document.getElementById("btnSend");
const btnStart = document.getElementById("btnStart");
const btnNext = document.getElementById("btnNext");
const btnStop = document.getElementById("btnStop");
const btnReport = document.getElementById("btnReport");
const onlineCountElement = document.getElementById("onlineCount");

const config = { 
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ] 
};

const SEARCHING_VIDEO_SRC = "/assets/searching.mp4"; 

// Banned Words (einfaches Filter-System)
const bannedWords = ["fuck", "sex", "nazi", "hitler", "porn", "xxx"];

// --- Hilfsfunktionen ---
function addMessage(sender, text, isSystem = false) {
    const div = document.createElement("div");
    div.textContent = `${sender}: ${text}`;
    if (isSystem) {
        div.style.color = '#ffc107'; 
        div.style.fontStyle = 'italic';
    }
    document.getElementById("systemMsg").appendChild(div);
}

// Kamera starten
async function startCamera() {
    if (localStream) return true;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        return true;
    } catch (err) {
        addMessage("System", "❌ Fehler beim Zugriff auf Kamera/Mikrofon. Bitte erlauben.", true);
        return false;
    }
}

function closePeerConnection() {
    if (peerConnection) {
        if (remoteVideo.srcObject && remoteVideo.srcObject.getTracks) {
            remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        }
        remoteVideo.srcObject = null;
        remoteVideo.src = SEARCHING_VIDEO_SRC;
        remoteVideo.loop = true;
        peerConnection.close();
        peerConnection = null;
    }
    dataChannel = null;
    addMessage("System", "Verbindung zum Partner beendet.", true);
    btnNext.disabled = true;
    sendBtn.disabled = true;
    input.disabled = true;
}

function createPeerConnection() {
    closePeerConnection(); 
    peerConnection = new RTCPeerConnection(config);

    if (localStream) {
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    peerConnection.ontrack = (event) => {
        remoteVideo.src = "";
        remoteVideo.srcObject = event.streams[0];
        remoteVideo.loop = false;
        addMessage("System", "🎥 Videoanruf gestartet!", true);
        btnNext.disabled = false;
        sendBtn.disabled = false;
        input.disabled = false;
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: "candidate", candidate: event.candidate }));
        }
    };
    
    // DataChannel
    dataChannel = peerConnection.createDataChannel("chat");
    dataChannel.onopen = () => addMessage("System", "💬 Chat-Kanal geöffnet.", true);
    dataChannel.onmessage = (event) => addMessage("Partner", event.data);

    peerConnection.ondatachannel = (event) => { 
        dataChannel = event.channel;
        dataChannel.onopen = () => addMessage("System", "💬 Chat-Kanal geöffnet.", true);
        dataChannel.onmessage = (e) => addMessage("Partner", e.data);
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (["disconnected", "failed"].includes(peerConnection.iceConnectionState)) {
            addMessage("System", `⚠️ Verbindung getrennt: ${peerConnection.iceConnectionState}`, true);
            closePeerConnection();
        }
    }
}

// --- WebSocket Events ---
ws.onopen = () => {
    addMessage("System", "✅ Verbunden mit Server. Klicke auf Start.", true);
    btnStart.disabled = false;
    btnStop.disabled = false;
};

ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "matched" && data.should_offer) {
        createPeerConnection();
        addMessage("System", "Partner gefunden. Sende Offer...", true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", offer }));

    } else if (data.type === "matched" && !data.should_offer) {
        addMessage("System", "Partner gefunden. Warte auf Offer...", true);

    } else if (data.type === "offer") {
        if (!peerConnection) createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", answer }));

    } else if (data.type === "answer") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));

    } else if (data.type === "candidate" && peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.warn("ICE Candidate Fehler:", err);
        }
    } else if (data.type === "partner-left") {
        addMessage("System", "Partner hat beendet.", true);
        closePeerConnection();
    } else if (data.type === "no-match") {
        addMessage("System", "Kein Partner gefunden, wir warten...", true);
    } else if (data.type === "user-count" && onlineCountElement) {
        onlineCountElement.textContent = data.count;
    }
};

// --- Button Events ---
btnStart.onclick = async () => {
    if (!await startCamera()) return; 
    remoteVideo.srcObject = null;
    remoteVideo.src = SEARCHING_VIDEO_SRC;
    remoteVideo.loop = true;
    ws.send(JSON.stringify({ type: "start" }));
    addMessage("System", "🔎 Suche nach Partner...", true);
    btnStart.disabled = true;
};

btnNext.onclick = () => {
    if (peerConnection) {
        ws.send(JSON.stringify({ type: "next" })); 
        closePeerConnection(); 
    }
    remoteVideo.srcObject = null;
    remoteVideo.src = SEARCHING_VIDEO_SRC;
    remoteVideo.loop = true;
    ws.send(JSON.stringify({ type: "start" }));
    addMessage("System", "🔎 Suche nach neuem Partner...", true);
    btnNext.disabled = true;
};

btnStop.onclick = () => {
    ws.send(JSON.stringify({ type: "stop" }));
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        localStream = null;
    }
    closePeerConnection();
    remoteVideo.srcObject = null;
    remoteVideo.src = "";
    remoteVideo.loop = false;
    addMessage("System", "⏹ Chat beendet.", true);
    btnStart.disabled = false;
    btnStop.disabled = true;
};

// 🚨 Melden
btnReport.onclick = () => {
    ws.send(JSON.stringify({ type: "report" }));
    addMessage("System", "🚨 Partner gemeldet.", true);
};

// Chat
sendBtn.onclick = () => {
    const text = input.value.trim();
    if (!text) return;

    // 🔎 Content Filter
    if (bannedWords.some(w => text.toLowerCase().includes(w))) {
        addMessage("System", "⚠️ Nachricht blockiert (unangemessen)", true);
        input.value = "";
        return;
    }

    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(text);
        addMessage("Ich", text);
        input.value = "";
    } else {
        addMessage("System", "Chat nicht bereit.", true);
    }
};
