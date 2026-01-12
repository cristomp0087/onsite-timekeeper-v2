/**
 * Settings Screen - OnSite Timekeeper v2
 * 
 * Accordion-style settings with timer configurations.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '../../src/constants/colors';
import { useAuthStore } from '../../src/stores/authStore';
import {
  useSettingsStore,
  TIMER_OPTIONS,
  REMINDER_FREQUENCY_OPTIONS,
  DAYS_OF_WEEK,
  getDayFullLabel,
  formatReminderTime,
  getFrequencyLabel,
} from '../../src/stores/settingsStore';
import { onUserLogout } from '../../src/lib/bootstrap';

// ============================================
// ACCORDION SECTION
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
        <View style={styles.accordionTitleRow}>
          <Ionicons name={icon} size={22} color={colors.primary} />
          <Text style={styles.accordionTitle}>{title}</Text>
        </View>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      {isOpen && <View style={styles.accordionContent}>{children}</View>}
    </View>
  );
}

// ============================================
// SELECT ROW (for timer options)
// ============================================

interface SelectRowProps {
  label: string;
  value: number;
  options: readonly { value: number; label: string }[];
  onChange: (value: number) => void;
  hint?: string;
}

function SelectRow({ label, value, options, onChange, hint }: SelectRowProps) {
  const [showOptions, setShowOptions] = useState(false);
  const currentOption = options.find(o => o.value === value);

  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelContainer}>
        <Text style={styles.settingLabel}>{label}</Text>
        {hint && <Text style={styles.settingHint}>{hint}</Text>}
      </View>
      
      <TouchableOpacity
        style={styles.selectButton}
        onPress={() => setShowOptions(!showOptions)}
      >
        <Text style={styles.selectButtonText}>
          {currentOption?.label || `${value}`}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {showOptions && (
        <View style={styles.optionsContainer}>
          {options.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.optionItem,
                option.value === value && styles.optionItemSelected,
              ]}
              onPress={() => {
                onChange(option.value);
                setShowOptions(false);
              }}
            >
              <Text
                style={[
                  styles.optionText,
                  option.value === value && styles.optionTextSelected,
                ]}
              >
                {option.label}
              </Text>
              {option.value === value && (
                <Ionicons name="checkmark" size={18} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ============================================
// SWITCH ROW
// ============================================

interface SwitchRowProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}

function SwitchRow({ label, value, onChange, hint }: SwitchRowProps) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelContainer}>
        <Text style={styles.settingLabel}>{label}</Text>
        {hint && <Text style={styles.settingHint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={value ? colors.primary : colors.textTertiary}
      />
    </View>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const settings = useSettingsStore();

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await onUserLogout();
            await signOut();
            router.replace('/');
          },
        },
      ]
    );
  };

  const handleResetSettings = () => {
    Alert.alert(
      'Reset Settings',
      'This will restore all settings to their default values.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => settings.resetSettings(),
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Header */}
      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.email?.charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.userName}>{user?.email || 'Guest'}</Text>
      </View>

      {/* ============================================ */}
      {/* TIMERS SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Timers" icon="timer-outline" defaultOpen>
        <SelectRow
          label="Entry timeout"
          value={settings.entryTimeoutMinutes}
          options={TIMER_OPTIONS.entryTimeout}
          onChange={(v) => settings.updateSetting('entryTimeoutMinutes', v)}
          hint="Time before auto-start when entering a location"
        />

        <View style={styles.divider} />

        <SelectRow
          label="Exit timeout"
          value={settings.exitTimeoutSeconds}
          options={TIMER_OPTIONS.exitTimeout}
          onChange={(v) => settings.updateSetting('exitTimeoutSeconds', v)}
          hint="Time before auto-stop when leaving a location"
        />

        <View style={styles.divider} />

        <SelectRow
          label="Return timeout"
          value={settings.returnTimeoutMinutes}
          options={TIMER_OPTIONS.returnTimeout}
          onChange={(v) => settings.updateSetting('returnTimeoutMinutes', v)}
          hint="Time before auto-resume when returning during pause"
        />

        <View style={styles.divider} />

        <SelectRow
          label="Pause limit"
          value={settings.pauseLimitMinutes}
          options={TIMER_OPTIONS.pauseLimit}
          onChange={(v) => settings.updateSetting('pauseLimitMinutes', v)}
          hint="Maximum pause duration before alarm"
        />

        <View style={styles.divider} />

        <SelectRow
          label="Exit adjustment"
          value={settings.exitAdjustmentMinutes}
          options={TIMER_OPTIONS.exitAdjustment}
          onChange={(v) => settings.updateSetting('exitAdjustmentMinutes', v)}
          hint="Minutes deducted from recorded time on auto-stop"
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* AUTO-ACTIONS SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Auto-Actions" icon="flash-outline">
        <SwitchRow
          label="Auto-start"
          value={settings.autoStartEnabled}
          onChange={(v) => settings.updateSetting('autoStartEnabled', v)}
          hint="Automatically start tracking when entering a location"
        />

        <View style={styles.divider} />

        <SwitchRow
          label="Auto-stop"
          value={settings.autoStopEnabled}
          onChange={(v) => settings.updateSetting('autoStopEnabled', v)}
          hint="Automatically stop tracking when leaving a location"
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* NOTIFICATIONS SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Notifications" icon="notifications-outline">
        <SwitchRow
          label="Notifications"
          value={settings.notificationsEnabled}
          onChange={(v) => settings.updateSetting('notificationsEnabled', v)}
          hint="Show notifications for geofence events"
        />

        <View style={styles.divider} />

        <SwitchRow
          label="Sound"
          value={settings.soundEnabled}
          onChange={(v) => settings.updateSetting('soundEnabled', v)}
        />

        <View style={styles.divider} />

        <SwitchRow
          label="Vibration"
          value={settings.vibrationEnabled}
          onChange={(v) => settings.updateSetting('vibrationEnabled', v)}
        />
      </AccordionSection>

      {/* ============================================ */}
      {/* DEBUG SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Developer" icon="code-outline">
        <SwitchRow
          label="Debug monitor"
          value={settings.devMonitorEnabled}
          onChange={(v) => settings.updateSetting('devMonitorEnabled', v)}
          hint="Show debug panel with GPS and geofence info"
        />

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => router.push('/')}
        >
          <Text style={styles.linkText}>View logs</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </AccordionSection>

      {/* ============================================ */}
      {/* ABOUT SECTION */}
      {/* ============================================ */}
      <AccordionSection title="About" icon="information-circle-outline">
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://onsiteclub.ca')}
        >
          <Text style={styles.linkText}>Website</Text>
          <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://onsiteclub.ca/privacy')}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://onsiteclub.ca/terms')}
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.versionRow}>
          <Text style={styles.versionLabel}>Version</Text>
          <Text style={styles.versionValue}>2.0.0</Text>
        </View>
      </AccordionSection>

      {/* ============================================ */}
      {/* ACCOUNT SECTION */}
      {/* ============================================ */}
      <AccordionSection title="Account" icon="person-outline">
        <TouchableOpacity style={styles.linkRow} onPress={handleResetSettings}>
          <Text style={styles.linkText}>Reset settings</Text>
          <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.dangerRow} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.dangerText}>Sign out</Text>
        </TouchableOpacity>
      </AccordionSection>

      <View style={styles.footer} />
    </ScrollView>
  );
}

// ============================================
// STYLES
// ============================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 40,
  },

  // Profile
  profileSection: {
    alignItems: 'center',
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '600',
    color: '#fff',
  },
  userName: {
    fontSize: 16,
    color: colors.textSecondary,
  },

  // Accordion
  accordionContainer: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  accordionTitleRow: {
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

  // Settings rows
  settingRow: {
    paddingVertical: 12,
  },
  settingLabelContainer: {
    flex: 1,
    marginBottom: 8,
  },
  settingLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  settingHint: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Select button
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectButtonText: {
    fontSize: 15,
    color: colors.text,
  },

  // Options dropdown
  optionsContainer: {
    marginTop: 8,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionItemSelected: {
    backgroundColor: colors.primaryLight + '20',
  },
  optionText: {
    fontSize: 15,
    color: colors.text,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '500',
  },

  // Link row
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 15,
    color: colors.text,
  },

  // Danger row
  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  dangerText: {
    fontSize: 15,
    color: colors.error,
    fontWeight: '500',
  },

  // Version
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  versionLabel: {
    fontSize: 15,
    color: colors.text,
  },
  versionValue: {
    fontSize: 15,
    color: colors.textSecondary,
  },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },

  footer: {
    height: 40,
  },
});
