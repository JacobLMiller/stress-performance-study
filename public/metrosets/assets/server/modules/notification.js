/**
 * Notification module for displaying temporary messages to the user
 */

export function showNotification(message, duration = 5000) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification-popup';
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: #ef4444;
        color: white;
        padding: 20px 40px;
        border-radius: 8px;
        font-size: 18px;
        font-weight: bold;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        animation: fadeIn 0.3s ease-in-out;
    `;
    
    // Add fade-in animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes fadeOut {
            from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            to { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        }
    `;
    if (!document.querySelector('style[data-notification-styles]')) {
        style.setAttribute('data-notification-styles', 'true');
        document.head.appendChild(style);
    }
    
    // Append to body
    document.body.appendChild(notification);
    
    // Return a promise that resolves when the notification should be removed
    return new Promise((resolve) => {
        if (duration > 0) {
            setTimeout(() => {
                notification.style.animation = 'fadeOut 0.3s ease-in-out';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                    resolve();
                }, 300);
            }, duration);
        } else {
            // If duration is 0 or negative, don't auto-remove
            resolve();
        }
    });
}

export function removeNotification(notification) {
    if (notification && notification.parentNode) {
        notification.style.animation = 'fadeOut 0.3s ease-in-out';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }
}

