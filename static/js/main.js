// Global variables
let localStream = null;
let peerConnection = null;
let currentRoom = null;
let isInitiator = false;
let socket = null;
let mediaConstraints = {
    audio: true,
    video: { width: 720, height: 480 }
};

// WebRTC configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// DOM elements
const videoLocal = document.getElementById('local-video');
const videoRemote = document.getElementById('remote-video');
const findButton = document.getElementById('find-button');
const stopButton = document.getElementById('stop-button');
const leaveButton = document.getElementById('leave-button');
const statusDiv = document.getElementById('status');
const userCountSpan = document.getElementById('user-count');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const videoContainer = document.getElementById('video-container');
const chatContainer = document.getElementById('chat-container');
const controlsContainer = document.getElementById('controls-container');

// Initialize the application
document.addEventListener('DOMContentLoaded', initialize);

function initialize() {
    // Setup Socket.IO connection
    socket = io();
    
    setupSocketEvents();
    setupUIEvents();
    
    // Get media stream
    getLocalStream().catch(handleMediaError);
}

// Set up Socket.IO event handlers
function setupSocketEvents() {
    socket.on('connect', () => {
        console.log('Connected to server');
        updateStatus('Connected to server');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateStatus('Disconnected from server');
        resetChat();
    });
    
    socket.on('user_count', (data) => {
        userCountSpan.textContent = data.count;
    });
    
    socket.on('waiting', () => {
        updateStatus('Waiting for a partner...');
        findButton.style.display = 'none';
        stopButton.style.display = 'inline-block';
        leaveButton.style.display = 'none';
        chatContainer.classList.add('d-none');
    });
    
    socket.on('search_stopped', () => {
        updateStatus('Search stopped');
        resetButtons();
    });
    
    socket.on('partner_found', (data) => {
        currentRoom = data.room;
        isInitiator = data.initiator;
        updateStatus('Partner found! Connecting...');
        
        stopButton.style.display = 'none';
        leaveButton.style.display = 'inline-block';
        chatContainer.classList.remove('d-none');
        
        // Create peer connection
        createPeerConnection();
        
        if (isInitiator) {
            createOffer();
        }
    });
    
    socket.on('partner_left', () => {
        updateStatus('Your partner has left');
        closePeerConnection();
        resetChat();
        resetButtons();
    });
    
    socket.on('signal', (data) => {
        handleSignalMessage(data);
    });
    
    socket.on('chat_message', (data) => {
        addChatMessage(data.message, false);
    });
}

// Set up UI event handlers
function setupUIEvents() {
    findButton.addEventListener('click', () => {
        findButton.disabled = true;
        socket.emit('find_partner');
    });
    
    stopButton.addEventListener('click', () => {
        socket.emit('stop_search');
    });
    
    leaveButton.addEventListener('click', () => {
        if (currentRoom) {
            socket.emit('leave_chat', { room: currentRoom });
            closePeerConnection();
            resetChat();
            resetButtons();
        }
    });
    
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && currentRoom) {
            socket.emit('chat_message', { room: currentRoom, message: message });
            addChatMessage(message, true);
            chatInput.value = '';
        }
    });
}

// Get local media stream
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        videoLocal.srcObject = localStream;
        updateStatus('Camera and microphone ready');
        findButton.disabled = false;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        updateStatus('Failed to access camera/microphone. ' + error.message, true);
        findButton.disabled = true;
    }
}

// Handle media errors
function handleMediaError(error) {
    console.error('Media error:', error);
    updateStatus('Camera/microphone error: ' + error.message, true);
}

// Create WebRTC peer connection
function createPeerConnection() {
    try {
        peerConnection = new RTCPeerConnection(iceServers);
        
        // Add local stream to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal({
                    type: 'candidate',
                    candidate: event.candidate,
                    room: currentRoom
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                updateStatus('Connected to partner');
            } else if (peerConnection.connectionState === 'disconnected' || 
                      peerConnection.connectionState === 'failed') {
                updateStatus('Connection issues with partner');
            }
        };
        
        // Handle receiving remote stream
        peerConnection.ontrack = (event) => {
            if (videoRemote.srcObject !== event.streams[0]) {
                videoRemote.srcObject = event.streams[0];
                console.log('Received remote stream');
            }
        };
        
        console.log('Created RTCPeerConnection');
    } catch (error) {
        console.error('Error creating RTCPeerConnection:', error);
        updateStatus('Failed to create connection', true);
    }
}

// Create and send offer to remote peer
async function createOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        sendSignal({
            type: 'offer',
            offer: offer,
            room: currentRoom
        });
        
        console.log('Created and sent offer');
    } catch (error) {
        console.error('Error creating offer:', error);
        updateStatus('Failed to create offer', true);
    }
}

// Create and send answer to remote peer
async function createAnswer(offer) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        sendSignal({
            type: 'answer',
            answer: answer,
            room: currentRoom
        });
        
        console.log('Created and sent answer');
    } catch (error) {
        console.error('Error creating answer:', error);
        updateStatus('Failed to create answer', true);
    }
}

// Handle incoming signal messages
async function handleSignalMessage(data) {
    if (!peerConnection) return;
    
    try {
        if (data.type === 'offer') {
            await createAnswer(data.offer);
        } else if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'candidate') {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    } catch (error) {
        console.error('Error handling signal:', error);
    }
}

// Send signal message to remote peer
function sendSignal(data) {
    socket.emit('signal', data);
}

// Close peer connection
function closePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (videoRemote.srcObject) {
        videoRemote.srcObject.getTracks().forEach(track => track.stop());
        videoRemote.srcObject = null;
    }
    
    currentRoom = null;
    console.log('Closed peer connection');
}

// Reset chat UI
function resetChat() {
    chatMessages.innerHTML = '';
    chatContainer.classList.add('d-none');
}

// Reset button states
function resetButtons() {
    findButton.style.display = 'inline-block';
    findButton.disabled = false;
    stopButton.style.display = 'none';
    leaveButton.style.display = 'none';
}

// Update status message
function updateStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = isError ? 'alert alert-danger' : 'alert alert-info';
}

// Add chat message to the chat box
function addChatMessage(message, isSelf) {
    const messageElement = document.createElement('div');
    messageElement.className = isSelf ? 'message self' : 'message other';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.textContent = message;
    
    messageElement.appendChild(messageContent);
    chatMessages.appendChild(messageElement);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
