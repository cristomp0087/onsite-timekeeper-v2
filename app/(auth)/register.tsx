/**
 * Register Screen - OnSite Timekeeper
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { colors } from '../../src/constants/colors';
import { Button, Input } from '../../src/components/ui/Button';
import { useAuthStore } from '../../src/stores/authStore';
import { isSupabaseConfigured } from '../../src/lib/supabase';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useAuthStore();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{
    nome?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    general?: string;
  }>({});

  const validate = () => {
    const newErrors: typeof errors = {};

    if (!nome) {
      newErrors.nome = 'Nome é obrigatório';
    } else if (nome.length < 2) {
      newErrors.nome = 'Nome deve ter pelo menos 2 caracteres';
    }

    if (!email) {
      newErrors.email = 'Email é obrigatório';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email inválido';
    }

    if (!password) {
      newErrors.password = 'Senha é obrigatória';
    } else if (password.length < 6) {
      newErrors.password = 'Senha deve ter pelo menos 6 caracteres';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Confirme sua senha';
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Senhas não conferem';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRegister = async () => {
    if (!validate()) return;

    if (!isSupabaseConfigured()) {
      Alert.alert(
        'Configuração necessária',
        'Configure as variáveis de ambiente do Supabase:\n\nEXPO_PUBLIC_SUPABASE_URL\nEXPO_PUBLIC_SUPABASE_ANON_KEY'
      );
      return;
    }

    setLoading(true);
    setErrors({});

    const { error } = await signUp(email, password, nome);

    setLoading(false);

    if (error) {
      setErrors({ general: error });
    } else {
      Alert.alert(
        'Conta criada!',
        'Verifique seu email para confirmar o cadastro.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.emoji}>📝</Text>
          <Text style={styles.title}>Criar conta</Text>
          <Text style={styles.subtitle}>Comece a registrar seu ponto</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {errors.general && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errors.general}</Text>
            </View>
          )}

          <Input
            label="Nome"
            placeholder="Seu nome"
            autoCapitalize="words"
            autoComplete="name"
            value={nome}
            onChangeText={setNome}
            error={errors.nome}
          />

          <Input
            label="Email"
            placeholder="seu@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
          />

          <Input
            label="Senha"
            placeholder="••••••••"
            secureTextEntry
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            error={errors.password}
          />

          <Input
            label="Confirmar senha"
            placeholder="••••••••"
            secureTextEntry
            autoComplete="new-password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={errors.confirmPassword}
          />

          <Button
            title="Criar conta"
            onPress={handleRegister}
            loading={loading}
            style={styles.button}
          />

          <View style={styles.linkContainer}>
            <Text style={styles.linkText}>Já tem conta? </Text>
            <Link href="/(auth)/login">
              <Text style={styles.link}>Fazer login</Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },

  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  emoji: {
    fontSize: 50,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },

  form: {
    width: '100%',
  },
  errorBox: {
    backgroundColor: colors.errorLight,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },

  button: {
    marginTop: 8,
  },

  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  linkText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  link: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
});
