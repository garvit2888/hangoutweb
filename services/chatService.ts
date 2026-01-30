import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy,
  serverTimestamp,
  Timestamp,
  doc,
  setDoc,
  where
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { GroupMessage } from '@/types';

/**
 * Chat Service - Manages chat messages in Firestore
 * Messages are stored in subcollections under each activity
 */

/**
 * Send a message to an activity's chat
 */
export const sendMessage = async (
  activityId: string, 
  message: {
    senderId: string;
    senderName: string;
    senderAvatar?: string;
    text: string;
    imageUri?: string;
  }
): Promise<string> => {
  try {
    console.log('🔥 Sending message to Firestore:', activityId);
    
    const messagesRef = collection(db, 'activities', activityId, 'messages');
    const docRef = await addDoc(messagesRef, {
      ...message,
      timestamp: serverTimestamp(), // Use server timestamp for consistency
      createdAt: new Date().toISOString(),
    });
    
    console.log('✅ Message sent to Firestore:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('❌ Error sending message to Firestore:', error);
    throw error;
  }
};

/**
 * Subscribe to real-time messages for an activity
 * Returns an unsubscribe function
 */
export const subscribeToMessages = (
  activityId: string,
  callback: (messages: GroupMessage[]) => void
): (() => void) => {
  try {
    console.log('🔥 Subscribing to messages for activity:', activityId);
    
    const messagesRef = collection(db, 'activities', activityId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messages: GroupMessage[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          senderId: data.senderId,
          senderName: data.senderName,
          senderAvatar: data.senderAvatar,
          text: data.text,
          imageUri: data.imageUri,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
        });
      });
      
      console.log(`🔄 Real-time messages update: ${messages.length} messages`);
      callback(messages);
    }, (error) => {
      console.error('❌ Error in message subscription:', error);
    });
    
    return unsubscribe;
  } catch (error) {
    console.error('❌ Error subscribing to messages:', error);
    return () => {};
  }
};

const TYPING_COLLECTION = 'typing_status';
const TYPING_TIMEOUT_MS = 5000;

export const setTypingStatus = async (
  activityId: string,
  userId: string,
  userName: string,
  isTyping: boolean
) => {
  try {
    const typingRef = doc(db, TYPING_COLLECTION, `${activityId}_${userId}`);
    if (isTyping) {
      await setDoc(typingRef, {
        activityId,
        userId,
        userName,
        isTyping: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else {
      await setDoc(typingRef, {
        activityId,
        userId,
        userName,
        isTyping: false,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  } catch (error) {
    console.error('❌ Error updating typing status:', error);
  }
};

export const subscribeToTypingStatus = (
  activityId: string,
  callback: (typingUsers: { userId: string; userName: string }[]) => void
): (() => void) => {
  try {
    const typingRef = collection(db, TYPING_COLLECTION);
    const q = query(typingRef, where('activityId', '==', activityId));

    const unsubscribe = onSnapshot(q, snapshot => {
      const now = Date.now();
      const typingUsers: { userId: string; userName: string }[] = [];

      snapshot.forEach(docSnapshot => {
        const data = docSnapshot.data() as any;
        if (data.activityId !== activityId) return;

        const updatedAt = data.updatedAt?.toDate?.()?.getTime?.() ?? now;
        if (!data.isTyping || now - updatedAt > TYPING_TIMEOUT_MS) {
          return;
        }

        typingUsers.push({
          userId: data.userId,
          userName: data.userName || 'Someone',
        });
      });

      callback(typingUsers);
    });

    return unsubscribe;
  } catch (error) {
    console.error('❌ Error subscribing to typing status:', error);
    return () => {};
  }
};
