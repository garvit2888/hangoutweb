import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { ArrowLeft, Bell } from 'lucide-react-native';
import { useNotificationStore } from '@/store/notificationStore';
import { Notification } from '@/services/notificationService';
import InstagramDefaultAvatar from '@/components/InstagramDefaultAvatar';

/**
 * Format relative time in Instagram compact format (e.g. "2h", "3d", "1w")
 */
const formatInstagramTime = (timestamp: string): string => {
  const now = new Date();
  const date = new Date(timestamp);
  const diffInSeconds = Math.max(1, Math.floor((now.getTime() - date.getTime()) / 1000));

  if (diffInSeconds < 60) {
    return `${diffInSeconds}s`;
  }
  const minutes = Math.floor(diffInSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo`;
};

interface NotificationSection {
  title: string;
  data: Notification[];
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, markAsRead, clearAllNotifications } = useNotificationStore();

  const handleNotificationPress = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }

    if (notification.activityId) {
      if (notification.type === 'new_message') {
        router.push(`/group-chat/${notification.activityId}`);
      } else {
        router.push(`/group-details/${notification.activityId}`);
      }
    }
  };

  // Group notifications strictly into Instagram timeframe sections:
  // Today, Yesterday, Last 7 days, Last 30 days, Earlier
  const sections = useMemo<NotificationSection[]>(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOf7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;
    const startOf30Days = startOfToday - 30 * 24 * 60 * 60 * 1000;

    const today: Notification[] = [];
    const yesterday: Notification[] = [];
    const last7Days: Notification[] = [];
    const last30Days: Notification[] = [];
    const earlier: Notification[] = [];

    notifications.forEach((item) => {
      const t = new Date(item.timestamp).getTime();
      if (t >= startOfToday) {
        today.push(item);
      } else if (t >= startOfYesterday) {
        yesterday.push(item);
      } else if (t >= startOf7Days) {
        last7Days.push(item);
      } else if (t >= startOf30Days) {
        last30Days.push(item);
      } else {
        earlier.push(item);
      }
    });

    const groups: NotificationSection[] = [];
    if (today.length > 0) groups.push({ title: 'Today', data: today });
    if (yesterday.length > 0) groups.push({ title: 'Yesterday', data: yesterday });
    if (last7Days.length > 0) groups.push({ title: 'Last 7 days', data: last7Days });
    if (last30Days.length > 0) groups.push({ title: 'Last 30 days', data: last30Days });
    if (earlier.length > 0) groups.push({ title: 'Earlier', data: earlier });

    return groups;
  }, [notifications]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Instagram Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ArrowLeft size={24} color="#000000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          {notifications.length > 0 ? (
            <TouchableOpacity
              onPress={clearAllNotifications}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.clearText}>Clear all</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {/* Notifications List */}
        <ScrollView
          style={styles.list}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
        >
          {notifications.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Bell size={38} color="#000000" />
              </View>
              <Text style={styles.emptyTitle}>No Notifications</Text>
              <Text style={styles.emptySubtext}>
                You will see activity updates, new messages, and member alerts here.
              </Text>
            </View>
          ) : (
            sections.map((section) => (
              <View key={section.title} style={styles.sectionBlock}>
                <Text style={styles.sectionHeader}>{section.title}</Text>
                {section.data.map((notification) => {
                  const hasCustomAvatar = Boolean(
                    (notification as any).avatar &&
                      (notification as any).avatar.trim() !== '' &&
                      !(notification as any).avatar.includes('ui-avatars.com')
                  );

                  return (
                    <TouchableOpacity
                      key={notification.id}
                      style={styles.notificationRow}
                      activeOpacity={0.6}
                      onPress={() => handleNotificationPress(notification)}
                    >
                      {/* Left Circular Avatar (Instagram style) */}
                      <View style={styles.avatarWrapper}>
                        {hasCustomAvatar ? (
                          <Image
                            source={{ uri: (notification as any).avatar }}
                            style={styles.avatarImage}
                          />
                        ) : (
                          <InstagramDefaultAvatar size={44} />
                        )}
                      </View>

                      {/* Content (Inline text + time like Instagram) */}
                      <View style={styles.textColumn}>
                        <Text style={styles.inlineText} numberOfLines={3}>
                          <Text style={styles.titleText}>{notification.title} </Text>
                          <Text style={styles.descText}>{notification.description} </Text>
                          <Text style={styles.timeText}>
                            {formatInstagramTime(notification.timestamp)}
                          </Text>
                        </Text>
                      </View>

                      {/* Unread Blue Dot Indicator */}
                      {!notification.read && <View style={styles.unreadDot} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 40,
  },
  sectionBlock: {
    marginTop: 10,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    letterSpacing: -0.2,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  avatarWrapper: {
    marginRight: 14,
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFEFEF',
  },
  textColumn: {
    flex: 1,
    paddingRight: 8,
  },
  inlineText: {
    fontSize: 14,
    lineHeight: 18,
    color: '#262626',
  },
  titleText: {
    fontWeight: '600',
    color: '#000000',
  },
  descText: {
    fontWeight: '400',
    color: '#262626',
  },
  timeText: {
    fontSize: 13,
    fontWeight: '400',
    color: '#8E8E93',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0095F6', // Instagram signature blue unread dot
    marginLeft: 6,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    paddingHorizontal: 36,
  },
  emptyIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 20,
  },
});
