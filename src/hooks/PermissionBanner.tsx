/**
 * Permission Banner - OnSite Timekeeper
 * 
 * Reusable banner component for permission warnings.
 * Shows at top of screen with action button.
 * 
 * FIX: Added ForegroundServiceKilledBanner and SmartPermissionBanner
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePermissionStatus } from '../hooks/usePermissionStatus';

const ICON_COLOR = '#F59E0B';

// ============================================
// TYPES
// ============================================

interface PermissionBannerProps {
  type: 'error' | 'warning' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}

// ============================================
// COMPONENT
// ============================================

export function PermissionBanner({
  type,
  message,
  actionLabel,
  onAction,
  onDismiss,
  icon,
}: PermissionBannerProps) {
  const styles = getStyles(type);
  const defaultIcon = type === 'error' 
    ? 'warning' 
    : type === 'warning' 
      ? 'alert-circle' 
      : 'information-circle';

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons 
          name={icon || defaultIcon} 
          size={20} 
          color={ICON_COLOR}
        />
        <Text style={styles.message} numberOfLines={2}>
          {message}
        </Text>
      </View>
      
      <View style={styles.actions}>
        {actionLabel && onAction && (
          <TouchableOpacity style={styles.actionButton} onPress={onAction}>
            <Text style={styles.actionText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
        
        {onDismiss && (
          <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
            <Ionicons name="close" size={18} color={ICON_COLOR} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ============================================
// SPECIFIC BANNERS
// ============================================

interface NotificationBannerProps {
  onOpenSettings: () => void;
  onDismiss?: () => void;
}

export function NotificationDisabledBanner({ onOpenSettings, onDismiss }: NotificationBannerProps) {
  return (
    <PermissionBanner
      type="error"
      icon="notifications-off"
      message="Notifications disabled. Your hours may not be tracked automatically."
      actionLabel="Enable"
      onAction={onOpenSettings}
      onDismiss={onDismiss}
    />
  );
}

interface LocationBannerProps {
  hasBackgroundPermission: boolean;
  onRequestPermission: () => void;
  onOpenSettings: () => void;
  onDismiss?: () => void;
}

export function LocationPermissionBanner({ 
  hasBackgroundPermission, 
  onRequestPermission, 
  onOpenSettings,
  onDismiss,
}: LocationBannerProps) {
  if (hasBackgroundPermission) {
    return null;
  }

  return (
    <PermissionBanner
      type="warning"
      icon="location"
      message='Enable "Always" location for automatic time tracking when you arrive/leave.'
      actionLabel="Allow"
      onAction={onRequestPermission}
      onDismiss={onDismiss}
    />
  );
}

// ============================================
// FOREGROUND SERVICE KILLED BANNER (NEW!)
// ============================================

interface ForegroundServiceBannerProps {
  onRestart: () => void;
  onDismiss?: () => void;
}

export function ForegroundServiceKilledBanner({ onRestart, onDismiss }: ForegroundServiceBannerProps) {
  return (
    <PermissionBanner
      type="error"
      icon="battery-dead"
      message="Background tracking stopped. Tap to restart monitoring."
      actionLabel="Restart"
      onAction={onRestart}
      onDismiss={onDismiss}
    />
  );
}

// ============================================
// STYLES
// ============================================

function getStyles(type: 'error' | 'warning' | 'info') {
  const backgroundColor = 
    type === 'error' ? '#FEE2E2' :
    type === 'warning' ? '#FEF3C7' :
    '#DBEAFE';

  const borderColor = 
    type === 'error' ? '#FCA5A5' :
    type === 'warning' ? '#FCD34D' :
    '#93C5FD';

  const textColor = 
    type === 'error' ? '#991B1B' :
    type === 'warning' ? '#92400E' :
    '#1E40AF';

  const iconColor = 
    type === 'error' ? '#DC2626' :
    type === 'warning' ? '#D97706' :
    '#2563EB';

  return StyleSheet.create({
    container: {
      backgroundColor,
      borderWidth: 1,
      borderColor,
      borderRadius: 12,
      padding: 12,
      marginHorizontal: 16,
      marginTop: Platform.OS === 'ios' ? 8 : 4,
      marginBottom: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    content: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    message: {
      flex: 1,
      fontSize: 13,
      fontWeight: '500',
      color: textColor,
      lineHeight: 18,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginLeft: 8,
    },
    actionButton: {
      backgroundColor: iconColor,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    actionText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },
    dismissButton: {
      padding: 4,
    },
  });
}

// ============================================
// COMBINED BANNER (for Home screen)
// ============================================

interface CombinedPermissionBannerProps {
  notificationsEnabled: boolean;
  locationBackground: boolean;
  onOpenSettings: () => void;
  onRequestLocationPermission: () => void;
}

export function CombinedPermissionBanner({
  notificationsEnabled,
  locationBackground,
  onOpenSettings,
  onRequestLocationPermission,
}: CombinedPermissionBannerProps) {
  // Priority: notification error > location warning
  if (!notificationsEnabled) {
    return (
      <NotificationDisabledBanner onOpenSettings={onOpenSettings} />
    );
  }

  if (!locationBackground) {
    return (
      <LocationPermissionBanner
        hasBackgroundPermission={false}
        onRequestPermission={onRequestLocationPermission}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return null;
}

// ============================================
// SMART PERMISSION BANNER (NEW!)
// Uses the hook internally - drop-in component
// ============================================

interface SmartPermissionBannerProps {
  onDismiss?: () => void;
}

export function SmartPermissionBanner({ onDismiss }: SmartPermissionBannerProps) {
  const {
    notificationsEnabled,
    locationBackground,
    foregroundServiceKilled,
    openAppSettings,
    requestLocationPermission,
    restartMonitoring,
  } = usePermissionStatus();

  // Priority order:
  // 1. Foreground service killed (most critical - tracking stopped)
  // 2. Notifications disabled (can't notify user)
  // 3. Location background disabled (can't track automatically)

  if (foregroundServiceKilled) {
    return (
      <ForegroundServiceKilledBanner
        onRestart={restartMonitoring}
        onDismiss={onDismiss}
      />
    );
  }

  if (!notificationsEnabled) {
    return (
      <NotificationDisabledBanner
        onOpenSettings={openAppSettings}
        onDismiss={onDismiss}
      />
    );
  }

  if (!locationBackground) {
    return (
      <LocationPermissionBanner
        hasBackgroundPermission={false}
        onRequestPermission={requestLocationPermission}
        onOpenSettings={openAppSettings}
        onDismiss={onDismiss}
      />
    );
  }

  return null;
}
