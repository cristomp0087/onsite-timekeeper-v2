/**
 * Settings Screen - OnSite Timekeeper v2
 * 
 * Android-style accordion sections
 * - Profile with photo placeholder
 * - Timer configurations
 * - Notifications
 * - Sync
 * - About & Support
 * - Account (logout, delete)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TouchableOpacity,
  Linking,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { useSyncStore } from '../../src/stores/syncStore';

// ============================================
// CONSTANTS
// ============================================

const TIMER_OPTIONS = {
  entryTimeout: [1, 2, 3, 5, 10],      // minutes
  exitTimeout: [10, 15, 20, 30, 60],   // seconds
  returnTimeout: [1, 2, 3, 5, 10],     // minutes
  pauseLimit: [15, 30, 45, 60],        // minutes
  exitAdjustment: [5, 10, 15, 20],     // minutes
};

const LINKS = {
  website: 'https://onsiteclub.ca',
  docs: 'https://onsiteclub.ca/docs',
  terms: 'https://onsiteclub.ca/terms',
  privacy: 'https://onsiteclub.ca/privacy',
  support: 'mailto:support@onsiteclub.ca',
};

// ============================================
// ACCORDION SECTION COMPONENT
// ============================================

interface AccordionProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AccordionSection({ title, icon, children, defaultOpen = false }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <View style={styles.accordionContainer}>
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <View style={styles.accordionHeaderLeft}>
          <Ionicons name={icon} size={22} color={colors.primary} />
          <Text style={styles.accordionTitle}>{title}</Text>
        </View>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      
      {isOpen && (
        <View style={styles.accordionContent}>
          {children}
        </View>
      )}
    </View>
  );
}

// ============================================
// SETTING ROW COMPONENTS
// ============================================

interface ToggleRowProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  description?: string;
}

function ToggleRow({ label, value, onChange, description }: ToggleRowProps) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingRowLeft}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description && <Text style={styles.settingDescription}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.primary, false: colors.border }}
        thumbColor={colors.white}
      />
    </View>
  );
}

interface SelectRowProps {
  label: string;
  value: number;
  options: number[];
  unit: string;
  onChange: (v: number) => void;
}

function SelectRow({ label, value, options, unit, onChange }: SelectRowProps) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.optionsRow}>
        {options.map((opt) => (
          <TouchableOpacity
            key={opt}
            style={[
              styles.optionButton,
              value === opt && styles.optionButtonActive,
            ]}
            onPress={() => onChange(opt)}
          >
            <Text
              style={[
                styles.optionText,
                value === opt && styles.optionTextActive,
              ]}
            >
              {opt}{unit}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  valueColor?: string;
}

function InfoRow({ label, value, valueColor }: InfoRowProps) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  );
}

interface LinkRowProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
}

function LinkRow({ label, icon, onPress, danger }: LinkRowProps) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.linkLabel, danger && styles.linkLabelDanger]}>{label}</Text>
      <Ionicons
        name={icon || 'chevron-forward'}
        size={18}
        color={danger ? colors.error : colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, getUserEmail, getUserName, getUserId } = useAuthStore();
  const settings = useSettingsStore();
  const { syncNow, isSyncing, lastSyncAt, isOnline } = useSyncStore();

  // ============================================
  // HANDLERS
  // ============================================

  const handleSync = async () => {
    if (!isOnline) {
      Alert.alert('Offline', 'No internet connection');
      return;
    }
    await syncNow();
    Alert.alert('✅ Sync Complete', 'Your data is up to date');
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      '⚠️ Delete Account',
      'This action is PERMANENT and cannot be undone. All your data will be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Second confirmation
            Alert.alert(
              '🚨 Final Confirmation',
              'Type DELETE to confirm account deletion.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'I understand, delete',
                  style: 'destructive',
                  onPress: async () => {
                    // TODO: Implement account deletion API call
                    Alert.alert('Account Deletion', 'Please contact support@onsiteclub.ca to delete your account.');
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  const handleReportProblem = () => {
    const subject = encodeURIComponent('OnSite Timekeeper - Bug Report');
    const body = encodeURIComponent(
      `\n\n---\nApp Version: 1.0.0\nUser ID: ${getUserId() || 'N/A'}\nDevice: ${require('react-native').Platform.OS}`
    );
    Linking.openURL(`mailto:support@onsiteclub.ca?subject=${subject}&body=${body}`);
  };

  const handleOpenLink = (url: string) => {
    Linking.openURL(url);
  };

  const handlePickPhoto = () => {
    // TODO: Implement photo picker
    Alert.alert('Coming Soon', 'Profile photo upload will be available soon!');
  };

  const formatLastSync = () => {
    if (!lastSyncAt) return 'Never';
    
    const now = new Date();
    const diff = now.getTime() - lastSyncAt.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      
      {/* ============================================ */}
      {/* PROFILE SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Profile" icon="person-outline" defaultOpen={true}>
        <View style={styles.profileSection}>
          <TouchableOpacity style={styles.avatarContainer} onPress={handlePickPhoto}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(getUserName() || 'U').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={12} color={colors.white} />
            </View>
          </TouchableOpacity>
          
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{getUserName() || 'User'}</Text>
            <Text style={styles.profileEmail}>{getUserEmail()}</Text>
          </View>
        </View>
      </AccordionSection>

      {/* ============================================ */}
      {/* TIMERS SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Timers & Automation" icon="timer-outline">
        <SelectRow
          label="Entry timeout"
          value={settings.entryTimeoutMinutes || 5}
          options={TIMER_OPTIONS.entryTimeout}
          unit="m"
          onChange={(v) => settings.updateSetting('entryTimeoutMinutes', v)}
        />
        <Text style={styles.settingHint}>
          Time before auto-start when entering a location
        </Text>

        <View style={styles.divider} />

        <SelectRow
          label="Exit timeout"
          value={settings.exitTimeoutSeconds || 15}
          options={TIMER_OPTIONS.exitTimeout}
          unit="s"
          onChange={(v) => settings.updateSetting('exitTimeoutSeconds', v)}
        />
        <Text style={styles.settingHint}>
          Time before auto-stop when leaving a location
        </Text>

        <View style={styles.divider} />

        <SelectRow
          label="Exit time adjustment"
          value={settings.exitAdjustmentMinutes || 10}
          options={TIMER_OPTIONS.exitAdjustment}
          unit="m"
          onChange={(v) => settings.updateSetting('exitAdjustmentMinutes', v)}
        />
        <Text style={styles.settingHint}>
          Minutes deducted from exit time on auto-stop
        </Text>

        <View style={styles.divider} />

        <SelectRow
          label="Pause limit"
          value={settings.pauseLimitMinutes || 30}
          options={TIMER_OPTIONS.pauseLimit}
          unit="m"
          onChange={(v) => settings.updateSetting('pauseLimitMinutes', v)}
        />
        <Text style={styles.settingHint}>
          Maximum pause duration before auto-stop
        </Text>
      </AccordionSection>

      {/* ============================================ */}
      {/* NOTIFICATIONS SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Notifications" icon="notifications-outline">
        <ToggleRow
          label="Enable notifications"
          value={settings.notificacoesAtivas}
          onChange={(v) => settings.updateSetting('notificacoesAtivas', v)}
        />
        <ToggleRow
          label="Sound"
          value={settings.somNotificacao}
          onChange={(v) => settings.updateSetting('somNotificacao', v)}
        />
        <ToggleRow
          label="Vibration"
          value={settings.vibracaoNotificacao}
          onChange={(v) => settings.updateSetting('vibracaoNotificacao', v)}
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* SYNC SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Synchronization" icon="cloud-outline">
        <InfoRow
          label="Status"
          value={isOnline ? '🟢 Online' : '🔴 Offline'}
        />
        <InfoRow
          label="Last sync"
          value={formatLastSync()}
        />
        
        <Text style={styles.syncMessage}>
          💡 Keep your data safe by syncing regularly
        </Text>

        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
          onPress={handleSync}
          disabled={isSyncing}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isSyncing ? 'sync' : 'cloud-upload-outline'}
            size={20}
            color={colors.white}
          />
          <Text style={styles.syncButtonText}>
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Text>
        </TouchableOpacity>
      </AccordionSection>

      {/* ============================================ */}
      {/* ABOUT SECTION */}
      {/* ============================================ */}
      <AccordionSection title="About" icon="information-circle-outline">
        <InfoRow label="Version" value="1.0.0" />
        <InfoRow label="Build" value="2024.01" />
        
        <View style={styles.divider} />

        <LinkRow
          label="Visit onsiteclub.ca"
          icon="globe-outline"
          onPress={() => handleOpenLink(LINKS.website)}
        />
        <LinkRow
          label="Documentation"
          icon="document-text-outline"
          onPress={() => handleOpenLink(LINKS.docs)}
        />
        <LinkRow
          label="Terms of Service"
          icon="shield-checkmark-outline"
          onPress={() => handleOpenLink(LINKS.terms)}
        />
        <LinkRow
          label="Privacy Policy"
          icon="lock-closed-outline"
          onPress={() => handleOpenLink(LINKS.privacy)}
        />

        <Text style={styles.legalNote}>
          All rights and legal information are available at onsiteclub.ca/docs
        </Text>
      </AccordionSection>

      {/* ============================================ */}
      {/* SUPPORT SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Support" icon="help-circle-outline">
        <LinkRow
          label="Report a problem"
          icon="bug-outline"
          onPress={handleReportProblem}
        />
        <LinkRow
          label="Send feedback"
          icon="chatbubble-outline"
          onPress={() => handleOpenLink(LINKS.support)}
        />
        <LinkRow
          label="Rate the app"
          icon="star-outline"
          onPress={() => Alert.alert('Coming Soon', 'App Store link coming soon!')}
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* DEVELOPER SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Developer" icon="code-slash-outline">
        <ToggleRow
          label="DevMonitor"
          value={settings.devMonitorHabilitado}
          onChange={(v) => settings.updateSetting('devMonitorHabilitado', v)}
          description="Shows floating debug button"
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* ACCOUNT SECTION (DANGER ZONE) */}
      {/* ============================================ */}
      <AccordionSection title="Account" icon="person-circle-outline">
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.white} />
          <Text style={styles.logoutButtonText}>Sign Out</Text>
        </TouchableOpacity>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerZoneTitle}>⚠️ Danger Zone</Text>
          <LinkRow
            label="Delete my account"
            icon="trash-outline"
            onPress={handleDeleteAccount}
            danger
          />
        </View>
      </AccordionSection>

      {/* ============================================ */}
      {/* FOOTER */}
      {/* ============================================ */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>OnSite Timekeeper</Text>
        <Text style={styles.footerText}>© 2024 OnSite Club</Text>
        <Text style={styles.footerText}>Made with ❤️ in Canada</Text>
      </View>

    </ScrollView>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  content: {
    paddingBottom: 40,
  },

  // Accordion
  accordionContainer: {
    backgroundColor: colors.background,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  accordionContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  // Profile
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.white,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Settings rows
  settingRow: {
    paddingVertical: 12,
  },
  settingRowLeft: {
    flex: 1,
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.text,
    marginBottom: 8,
  },
  settingDescription: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  settingHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: -4,
    marginBottom: 4,
  },

  // Options row (for timer selections)
  optionsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  optionButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  optionTextActive: {
    color: colors.white,
  },

  // Info rows
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  infoLabel: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },

  // Link rows
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  linkLabel: {
    fontSize: 15,
    color: colors.text,
  },
  linkLabelDanger: {
    color: colors.error,
  },

  // Sync
  syncMessage: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: 12,
    fontStyle: 'italic',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },

  // Legal note
  legalNote: {
    fontSize: 11,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },

  // Logout button
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.textSecondary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.white,
  },

  // Danger zone
  dangerZone: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.error + '30',
  },
  dangerZoneTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.error,
    marginBottom: 8,
  },

  // Footer
  footer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
    gap: 2,
  },
  footerText: {
    fontSize: 12,
    color: colors.textTertiary,
  },
});
