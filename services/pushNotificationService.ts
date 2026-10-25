/**
 * Push Notification Service
 * Handles device push notifications for messages and activity events
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useNotificationStore } from '@/store/notificationStore';

// Configure notification behavior
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Request notification permissions
 */
export const requestNotificationPermissions = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('⚠️ Notification permissions not granted');
      return false;
    }

    // Configure notification channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });

      // Channel for messages
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
      });

      // Channel for activity events
      await Notifications.setNotificationChannelAsync('activity', {
        name: 'Activity Events',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    console.log('✅ Notification permissions granted');
    return true;
  } catch (error) {
    console.error('❌ Error requesting notification permissions:', error);
    return false;
  }
};

/**
 * Get device push token (for future backend integration)
 */
export const getPushToken = async (): Promise<string | null> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      return null;
    }

    // Get project ID from Expo constants
    const { Constants } = require('expo-constants');
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ||
      Constants?.easConfig?.projectId;

    if (!projectId) {
      console.warn('⚠️ No Expo project ID found. Push tokens require a project ID.');
      return null;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    console.log('📱 Push token:', token.data);
    return token.data;
  } catch (error) {
    console.error('❌ Error getting push token:', error);
    return null;
  }
};

/**
 * Schedule a local push notification
 */
export const sendPushNotification = async (
  title: string,
  body: string,
  data?: { activityId?: string; type?: string;[key: string]: any },
  channelId: string = 'default'
): Promise<void> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      console.warn('⚠️ Cannot send notification: permissions not granted');
      return;
    }

    // Save to in-app notification store
    try {
      const { addNotification } = useNotificationStore.getState();

      // Determine notification type safely
      const notificationType = (data?.type as any) || 'system';

      addNotification({
        type: notificationType,
        title,
        description: body,
        activityId: data?.activityId,
        activityName: data?.activityName,
        activityEmoji: data?.activityEmoji,
        userId: data?.userId,
        userName: data?.userName,
      });
      console.log('💾 Notification saved to store');
    } catch (storeError) {
      console.error('❌ Error saving notification to store:', storeError);
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null, // Show immediately
    });
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
  }
};

/**
 * Send notification for new message
 */
export const notifyNewMessage = async (
  activityName: string,
  senderName: string,
  messageText: string,
  activityId: string,
  activityEmoji?: string
): Promise<void> => {
  const title = activityEmoji
    ? `${activityEmoji} ${activityName}`
    : activityName;

  const body = messageText.length > 50
    ? `${senderName}: ${messageText.substring(0, 50)}...`
    : `${senderName}: ${messageText}`;

  await sendPushNotification(
    title,
    body,
    {
      activityId,
      type: 'new_message',
      activityName,
      activityEmoji,
      userName: senderName,
    },
    Platform.OS === 'android' ? 'messages' : 'default'
  );
};

/**
 * Send notification for photo message
 */
export const notifyPhotoMessage = async (
  activityName: string,
  senderName: string,
  activityId: string,
  activityEmoji?: string
): Promise<void> => {
  const title = activityEmoji
    ? `${activityEmoji} ${activityName}`
    : activityName;

  await sendPushNotification(
    title,
    `${senderName} sent a photo`,
    {
      activityId,
      type: 'new_message',
      activityName,
      activityEmoji,
      userName: senderName,
    },
    Platform.OS === 'android' ? 'messages' : 'default'
  );
};

/**
 * Send notification for member joined
 */
export const notifyMemberJoined = async (
  activityName: string,
  memberName: string,
  activityId: string,
  activityEmoji?: string
): Promise<void> => {
  const title = activityEmoji
    ? `${activityEmoji} ${activityName}`
    : activityName;

  await sendPushNotification(
    title,
    `${memberName} joined the activity`,
    {
      activityId,
      type: 'member_joined',
      activityName,
      activityEmoji,
      userName: memberName,
    },
    Platform.OS === 'android' ? 'activity' : 'default'
  );
};

/**
 * Send notification for member left
 */
export const notifyMemberLeft = async (
  activityName: string,
  memberName: string,
  activityId: string,
  activityEmoji?: string
): Promise<void> => {
  const title = activityEmoji
    ? `${activityEmoji} ${activityName}`
    : activityName;

  await sendPushNotification(
    title,
    `${memberName} left the activity`,
    {
      activityId,
      type: 'member_left',
      activityName,
      activityEmoji,
      userName: memberName,
    },
    Platform.OS === 'android' ? 'activity' : 'default'
  );
};

/**
 * Cancel all notifications
 */
export const cancelAllNotifications = async (): Promise<void> => {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('❌ Error canceling notifications:', error);
  }
};

/**
 * Get badge count
 */
export const getBadgeCount = async (): Promise<number> => {
  try {
    return await Notifications.getBadgeCountAsync();
  } catch (error) {
    console.error('❌ Error getting badge count:', error);
    return 0;
  }
};

/**
 * Set badge count
 */
export const setBadgeCount = async (count: number): Promise<void> => {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('❌ Error setting badge count:', error);
  }
};

