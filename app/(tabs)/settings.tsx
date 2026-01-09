/**
 * Settings Screen - OnSite Timekeeper v2
 * 
 * Android-style accordion sections
 * - Profile with photo placeholder
 * - Timer configurations
 * - Auto-Report (NEW) - Favorite contact + Reminder
 * - Notifications
 * - Sync
 * - About & Support
 * - Account (logout, delete)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TouchableOpacity,
  Linking,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import { useSettingsStore, getDayShortLabel, formatReminderTime, getFrequencyLabel } from '../../src/stores/settingsStore';
import type { FavoriteContact, ReportReminder } from '../../src/stores/settingsStore';
import { useSyncStore } from '../../src/stores/syncStore';
import { scheduleReportReminder, cancelReportReminder } from '../../src/lib/notifications';

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

const DAYS_OF_WEEK = [
  { value: 0, label: 'S', fullLabel: 'Sunday' },
  { value: 1, label: 'M', fullLabel: 'Monday' },
  { value: 2, label: 'T', fullLabel: 'Tuesday' },
  { value: 3, label: 'W', fullLabel: 'Wednesday' },
  { value: 4, label: 'T', fullLabel: 'Thursday' },
  { value: 5, label: 'F', fullLabel: 'Friday' },
  { value: 6, label: 'S', fullLabel: 'Saturday' },
];

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
  // AUTO-REPORT LOCAL STATE
  // ============================================
  
  const [contactType, setContactType] = useState<'whatsapp' | 'email'>(
    settings.favoriteContact?.type || 'whatsapp'
  );
  const [contactValue, setContactValue] = useState(
    settings.favoriteContact?.value || ''
  );
  const [contactName, setContactName] = useState(
    settings.favoriteContact?.name || ''
  );
  const [hasUnsavedContact, setHasUnsavedContact] = useState(false);

  // Track changes to contact fields
  useEffect(() => {
    const current = settings.favoriteContact;
    const changed = 
      contactType !== (current?.type || 'whatsapp') ||
      contactValue !== (current?.value || '') ||
      contactName !== (current?.name || '');
    setHasUnsavedContact(changed && contactValue.length > 0);
  }, [contactType, contactValue, contactName, settings.favoriteContact]);

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
            Alert.alert(
              '🚨 Final Confirmation',
              'Type DELETE to confirm account deletion.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'I understand, delete',
                  style: 'destructive',
                  onPress: async () => {
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
  // AUTO-REPORT HANDLERS
  // ============================================

  const handleSaveContact = () => {
    if (!contactValue.trim()) {
      Alert.alert('Error', 'Please enter a contact');
      return;
    }

    // Basic validation
    if (contactType === 'whatsapp') {
      const phone = contactValue.replace(/\D/g, '');
      if (phone.length < 10) {
        Alert.alert('Error', 'Please enter a valid phone number');
        return;
      }
    } else {
      if (!contactValue.includes('@') || !contactValue.includes('.')) {
        Alert.alert('Error', 'Please enter a valid email address');
        return;
      }
    }

    const contact: FavoriteContact = {
      type: contactType,
      value: contactValue.trim(),
      name: contactName.trim() || undefined,
    };

    settings.setFavoriteContact(contact);
    setHasUnsavedContact(false);
    Alert.alert('✅ Saved', 'Favorite contact saved successfully');
  };

  const handleClearContact = () => {
    Alert.alert(
      'Clear Contact',
      'Remove favorite contact?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            settings.clearFavoriteContact();
            setContactValue('');
            setContactName('');
            setHasUnsavedContact(false);
          },
        },
      ]
    );
  };

  const handleTestSend = async () => {
    if (!contactValue.trim()) {
      Alert.alert('Error', 'Please enter and save a contact first');
      return;
    }

    const testMessage = '🧪 Test message from OnSite Timekeeper\n\nIf you receive this, your favorite contact is configured correctly!';

    if (contactType === 'whatsapp') {
      const phone = contactValue.replace(/\D/g, '');
      const url = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(testMessage)}`;
      
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'WhatsApp is not installed');
      }
    } else {
      const subject = encodeURIComponent('Test - OnSite Timekeeper');
      const body = encodeURIComponent(testMessage);
      const url = `mailto:${contactValue}?subject=${subject}&body=${body}`;
      await Linking.openURL(url);
    }
  };

  const handleToggleReminder = async (enabled: boolean) => {
    settings.toggleReportReminder(enabled);
    
    if (enabled) {
      await scheduleReportReminder(settings.reportReminder);
      Alert.alert(
        '🔔 Reminder Enabled',
        `You'll be reminded ${getFrequencyLabel(settings.reportReminder.frequency).toLowerCase()} on ${getDayShortLabel(settings.reportReminder.dayOfWeek)} at ${formatReminderTime(settings.reportReminder.hour, settings.reportReminder.minute)}`
      );
    } else {
      await cancelReportReminder();
    }
  };

  const handleUpdateReminder = async (updates: Partial<ReportReminder>) => {
    settings.updateReportReminder(updates);
    
    // Reschedule if enabled
    if (settings.reportReminder.enabled) {
      const updated = { ...settings.reportReminder, ...updates };
      await scheduleReportReminder(updated);
    }
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
      {/* AUTO-REPORT SECTION (NEW) */}
      {/* ============================================ */}
      <AccordionSection title="Auto-Report" icon="send-outline">
        {/* Favorite Contact */}
        <Text style={styles.sectionSubtitle}>Favorite Contact</Text>
        <Text style={styles.settingHint}>
          Quick send reports to this contact
        </Text>

        {/* Type selector */}
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[styles.typeBtn, contactType === 'whatsapp' && styles.typeBtnActive]}
            onPress={() => setContactType('whatsapp')}
          >
            <Text style={[styles.typeBtnText, contactType === 'whatsapp' && styles.typeBtnTextActive]}>
              📱 WhatsApp
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, contactType === 'email' && styles.typeBtnActive]}
            onPress={() => setContactType('email')}
          >
            <Text style={[styles.typeBtnText, contactType === 'email' && styles.typeBtnTextActive]}>
              📧 Email
            </Text>
          </TouchableOpacity>
        </View>

        {/* Contact input */}
        <TextInput
          style={styles.contactInput}
          placeholder={contactType === 'whatsapp' ? '+1 555 123 4567' : 'email@company.com'}
          placeholderTextColor={colors.textTertiary}
          value={contactValue}
          onChangeText={setContactValue}
          keyboardType={contactType === 'whatsapp' ? 'phone-pad' : 'email-address'}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Name input */}
        <TextInput
          style={styles.contactInput}
          placeholder="Name (optional, e.g. Supervisor)"
          placeholderTextColor={colors.textTertiary}
          value={contactName}
          onChangeText={setContactName}
          autoCapitalize="words"
        />

        {/* Action buttons */}
        <View style={styles.contactActions}>
          {settings.favoriteContact && (
            <TouchableOpacity style={styles.clearBtn} onPress={handleClearContact}>
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={[styles.testBtn, !contactValue && styles.btnDisabled]} 
            onPress={handleTestSend}
            disabled={!contactValue}
          >
            <Text style={styles.testBtnText}>🧪 Test</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.saveContactBtn, !hasUnsavedContact && styles.btnDisabled]} 
            onPress={handleSaveContact}
            disabled={!hasUnsavedContact}
          >
            <Text style={styles.saveContactBtnText}>💾 Save</Text>
          </TouchableOpacity>
        </View>

        {settings.favoriteContact && (
          <View style={styles.savedContactBadge}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.savedContactText}>
              Saved: {settings.favoriteContact.name || settings.favoriteContact.value}
            </Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* Report Reminder */}
        <ToggleRow
          label="Report Reminder"
          value={settings.reportReminder.enabled}
          onChange={handleToggleReminder}
          description="Get notified when your report is ready"
        />

        {settings.reportReminder.enabled && (
          <>
            {/* Frequency */}
            <Text style={styles.settingLabel}>Frequency</Text>
            <View style={styles.frequencyOptions}>
              {(['weekly', 'biweekly', 'monthly'] as const).map(freq => (
                <TouchableOpacity
                  key={freq}
                  style={[
                    styles.freqBtn,
                    settings.reportReminder.frequency === freq && styles.freqBtnActive
                  ]}
                  onPress={() => handleUpdateReminder({ frequency: freq })}
                >
                  <Text style={[
                    styles.freqBtnText,
                    settings.reportReminder.frequency === freq && styles.freqBtnTextActive
                  ]}>
                    {getFrequencyLabel(freq)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Day of week (only for weekly/biweekly) */}
            {settings.reportReminder.frequency !== 'monthly' && (
              <>
                <Text style={styles.settingLabel}>Day</Text>
                <View style={styles.daySelector}>
                  {DAYS_OF_WEEK.map((day) => (
                    <TouchableOpacity
                      key={day.value}
                      style={[
                        styles.dayBtn,
                        settings.reportReminder.dayOfWeek === day.value && styles.dayBtnActive
                      ]}
                      onPress={() => handleUpdateReminder({ dayOfWeek: day.value })}
                    >
                      <Text style={[
                        styles.dayBtnText,
                        settings.reportReminder.dayOfWeek === day.value && styles.dayBtnTextActive
                      ]}>
                        {day.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Time */}
            <Text style={styles.settingLabel}>Time</Text>
            <View style={styles.timeSelector}>
              <TextInput
                style={styles.timeInput}
                value={settings.reportReminder.hour.toString().padStart(2, '0')}
                onChangeText={(t) => {
                  const num = parseInt(t.replace(/\D/g, ''), 10);
                  if (!isNaN(num) && num >= 0 && num <= 23) {
                    handleUpdateReminder({ hour: num });
                  }
                }}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
              <Text style={styles.timeSeparator}>:</Text>
              <TextInput
                style={styles.timeInput}
                value={settings.reportReminder.minute.toString().padStart(2, '0')}
                onChangeText={(t) => {
                  const num = parseInt(t.replace(/\D/g, ''), 10);
                  if (!isNaN(num) && num >= 0 && num <= 59) {
                    handleUpdateReminder({ minute: num });
                  }
                }}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
              />
            </View>

            <Text style={styles.reminderSummary}>
              💡 Next reminder: {getDayShortLabel(settings.reportReminder.dayOfWeek)} at {formatReminderTime(settings.reportReminder.hour, settings.reportReminder.minute)}
            </Text>
          </>
        )}
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
        <InfoRow label="Build" value="2025.01" />
        
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
        <Text style={styles.footerText}>© 2025 OnSite Club</Text>
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

  // Section subtitle
  sectionSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
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

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },

  // ============================================
  // AUTO-REPORT STYLES (NEW)
  // ============================================

  typeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  typeBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  typeBtnTextActive: {
    color: colors.black,
  },

  contactInput: {
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    marginBottom: 8,
  },

  contactActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  clearBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.error,
  },
  testBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  testBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  saveContactBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveContactBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.black,
  },
  btnDisabled: {
    opacity: 0.5,
  },

  savedContactBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: colors.success + '20',
    borderRadius: 6,
  },
  savedContactText: {
    fontSize: 13,
    color: colors.success,
  },

  frequencyOptions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  freqBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  freqBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  freqBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
  },
  freqBtnTextActive: {
    color: colors.black,
  },

  daySelector: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  dayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  dayBtnTextActive: {
    color: colors.black,
  },

  timeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeInput: {
    width: 50,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  timeSeparator: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginHorizontal: 6,
  },

  reminderSummary: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
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
