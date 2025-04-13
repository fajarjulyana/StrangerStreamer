import os
import logging
from app import app

if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)
    from app import socketio
    socketio.run(app, host="0.0.0.0", port=5000, debug=True, allow_unsafe_werkzeug=True)
