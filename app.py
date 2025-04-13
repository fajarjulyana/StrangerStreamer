import os
import uuid
import logging
from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room

# Flask app setup
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev_secret_key")

# Configure Flask-SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")

# In-memory storage for active users
active_users = {}
waiting_users = []

@app.before_request
def before_request():
    """Create a unique session ID for each user if they don't have one"""
    if 'user_id' not in session:
        session['user_id'] = str(uuid.uuid4())

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    """Handle new user connections"""
    user_id = session.get('user_id')
    if not user_id:
        return
    
    # Add user to active users
    active_users[user_id] = request.sid
    logging.debug(f"User {user_id} connected. Active users: {len(active_users)}")
    
    # Broadcast updated user count
    emit('user_count', {'count': len(active_users)}, broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle user disconnections"""
    user_id = session.get('user_id')
    if not user_id:
        return
    
    # Remove user from active users and waiting list
    if user_id in active_users:
        del active_users[user_id]
    
    if user_id in waiting_users:
        waiting_users.remove(user_id)
    
    logging.debug(f"User {user_id} disconnected. Active users: {len(active_users)}")
    
    # Broadcast updated user count
    emit('user_count', {'count': len(active_users)}, broadcast=True)

@socketio.on('find_partner')
def find_partner():
    """Find a chat partner for the user"""
    user_id = session.get('user_id')
    if not user_id or user_id not in active_users:
        return
    
    # Remove user from waiting list if they're already there
    if user_id in waiting_users:
        waiting_users.remove(user_id)
    
    # If there are waiting users, match with the first one
    if waiting_users:
        partner_id = waiting_users.pop(0)
        
        # Create a unique room ID for these two users
        room_id = f"{user_id}_{partner_id}"
        
        # Join both users to the room
        join_room(room_id, sid=active_users[user_id])
        join_room(room_id, sid=active_users[partner_id])
        
        # Notify both users about the match
        emit('partner_found', {'room': room_id, 'initiator': True}, room=active_users[user_id])
        emit('partner_found', {'room': room_id, 'initiator': False}, room=active_users[partner_id])
        
        logging.debug(f"Matched users {user_id} and {partner_id} in room {room_id}")
    else:
        # Add user to waiting list
        waiting_users.append(user_id)
        emit('waiting')
        logging.debug(f"User {user_id} is now waiting. Waiting users: {len(waiting_users)}")

@socketio.on('stop_search')
def stop_search():
    """Stop searching for a partner"""
    user_id = session.get('user_id')
    if not user_id:
        return
    
    if user_id in waiting_users:
        waiting_users.remove(user_id)
        logging.debug(f"User {user_id} stopped searching. Waiting users: {len(waiting_users)}")
        emit('search_stopped')

@socketio.on('leave_chat')
def leave_chat(data):
    """Leave the current chat room"""
    room = data.get('room')
    if not room:
        return
    
    leave_room(room)
    emit('partner_left', room=room, include_self=False)
    logging.debug(f"User left room {room}")

@socketio.on('signal')
def handle_signal(data):
    """Forward WebRTC signaling data to the partner"""
    room = data.get('room')
    if not room:
        return
    
    emit('signal', data, room=room, include_self=False)

@socketio.on('chat_message')
def handle_chat_message(data):
    """Forward chat messages to the partner"""
    room = data.get('room')
    message = data.get('message')
    
    if not room or not message:
        return
    
    emit('chat_message', {'message': message}, room=room, include_self=False)
    logging.debug(f"Chat message in room {room}")

if __name__ == '__main__':
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
