import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useUserStore } from '@/store/userStore';
import { sendEmailVerification, reload } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { Mail, AlertCircle, CheckCircle } from 'lucide-react-native';

export default function EmailVerificationScreen() {
  const router = useRouter();
  const { loginEmail, profile, updateEmailVerification, setOnboardingCompleted } = useUserStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [emailSent, setEmailSent] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type?: 'info' | 'error' | 'success';
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'info',
  });

  const showAlert = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setAlertConfig({ visible: true, title, message, type });
    if (Platform.OS !== 'web') {
      Alert.alert(title, message);
    }
  };

  const targetEmail = auth.currentUser?.email || loginEmail || profile?.email || '';

  // Send verification email on mount if user is available
  useEffect(() => {
    if (auth.currentUser && auth.currentUser.email) {
      sendVerificationEmail();
    }
  }, []);

  useEffect(() => {
    // Start cooldown timer for resend button
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const sendVerificationEmail = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        showAlert('No Account Email', 'No signed-in email address was found. Please sign in or create an account first.', 'error');
        return;
      }

      if (currentUser.emailVerified) {
        // Already verified, skip
        handleVerificationComplete();
        return;
      }

      await sendEmailVerification(currentUser);
      setEmailSent(true);
      setResendCooldown(60);
      console.log('✅ Verification email sent to:', currentUser.email);
      showAlert(
        'Email Sent',
        `A verification email has been sent to ${currentUser.email}. Please check your inbox and spam folder.`,
        'success'
      );
    } catch (error: any) {
      console.error('Send verification email error:', error);
      
      let errorMessage = 'Failed to send verification email.';
      
      if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many requests. Please wait a minute and try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      showAlert('Error', errorMessage, 'error');
    }
  };

  const handleCheckVerification = async () => {
    try {
      setIsVerifying(true);
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        showAlert('Not Signed In', 'No user is currently signed in. Please go to the sign-in screen.', 'error');
        return;
      }

      // Reload user to get updated emailVerified status
      await reload(currentUser);

      if (currentUser.emailVerified) {
        // Email is verified!
        await handleVerificationComplete();
      } else {
        showAlert(
          'Not Verified Yet',
          'Please open your email inbox, click the verification link, and then tap "I\'ve Verified My Email".',
          'info'
        );
      }
    } catch (error: any) {
      console.error('Check verification error:', error);
      showAlert('Verification Error', error.message || 'Failed to check verification status. Please try again.', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleVerificationComplete = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      // Update Firestore - mark email verified (profile picture is next step)
      await updateDoc(doc(db, 'users', currentUser.uid), {
        isEmailVerified: true,
        updatedAt: new Date().toISOString(),
      });

      // Update local store
      updateEmailVerification(true);

      console.log('✅ Email verification complete - proceeding to profile picture upload');

      // Redirect to profile picture upload (mandatory step)
      router.push('/upload-profile-picture');
    } catch (error: any) {
      console.error('Verification complete error:', error);
      showAlert('Error', error.message || 'Failed to complete setup. Please try again.', 'error');
    }
  };

  const handleResendCode = () => {
    if (resendCooldown > 0) return;
    sendVerificationEmail();
  };

  return (
    <LinearGradient
      colors={[Colors.primary, Colors.darkPurple]}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.subtitle}>
            {targetEmail
              ? `We've sent a verification link to your email:`
              : 'Please sign in or create an account to verify your email.'}
          </Text>
          {targetEmail ? (
            <View style={styles.emailBadge}>
              <Mail size={16} color={Colors.secondary} style={{ marginRight: 8 }} />
              <Text style={styles.emailBadgeText}>{targetEmail}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.verificationContainer}>
          <View style={styles.iconContainer}>
            <Mail size={44} color={Colors.secondary} />
          </View>

          {targetEmail ? (
            <>
              <Text style={styles.instruction}>
                1. Check your email inbox (and spam/junk folder){'\n'}
                2. Click the verification link from Firebase{'\n'}
                3. Return here and tap "I've Verified My Email"
              </Text>

              <TouchableOpacity
                style={[styles.verifyButton, isVerifying && styles.verifyButtonDisabled]}
                onPress={handleCheckVerification}
                disabled={isVerifying}
              >
                <Text style={styles.verifyButtonText}>
                  {isVerifying ? 'Checking...' : "I've Verified My Email"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ alignItems: 'center', width: '100%', marginBottom: 20 }}>
              <Text style={[styles.instruction, { color: 'rgba(255, 255, 255, 0.7)' }]}>
                No email is currently associated with this session. Please return to the login screen.
              </Text>
              <TouchableOpacity
                style={styles.verifyButton}
                onPress={() => router.replace('/login')}
              >
                <Text style={styles.verifyButtonText}>Go to Sign In / Sign Up</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {targetEmail ? (
          <View style={styles.resendContainer}>
            <Text style={styles.resendText}>Didn't receive the email?</Text>
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleResendCode}
              disabled={resendCooldown > 0}
            >
              <Text style={[styles.resendButtonText, resendCooldown > 0 && styles.resendButtonDisabled]}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Email'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity 
          style={styles.backToLoginButton}
          onPress={() => router.replace('/login')}
        >
          <Text style={styles.backToLoginText}>Switch Account or Sign In</Text>
        </TouchableOpacity>
      </View>

      {/* Custom Alert Modal for Web & Cross-Platform */}
      <Modal
        visible={alertConfig.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.alertCard}>
            <View style={[
              styles.alertIconCircle,
              alertConfig.type === 'error' && { backgroundColor: 'rgba(255, 59, 48, 0.15)' },
              alertConfig.type === 'success' && { backgroundColor: 'rgba(52, 199, 89, 0.15)' },
            ]}>
              {alertConfig.type === 'success' ? (
                <CheckCircle size={28} color="#34C759" />
              ) : (
                <AlertCircle size={28} color={alertConfig.type === 'error' ? '#FF3B30' : Colors.secondary} />
              )}
            </View>
            <Text style={styles.alertTitle}>{alertConfig.title}</Text>
            <Text style={styles.alertMessage}>{alertConfig.message}</Text>
            <TouchableOpacity
              style={styles.alertButton}
              onPress={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
            >
              <Text style={styles.alertButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 480,
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    justifyContent: 'space-between',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 12,
  },
  emailBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: 4,
  },
  emailBadgeText: {
    color: Colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  verificationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  iconContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  instruction: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 24,
  },
  verifyButton: {
    backgroundColor: Colors.secondary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    marginBottom: 16,
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  verifyButtonDisabled: {
    backgroundColor: Colors.gray,
    opacity: 0.7,
  },
  verifyButtonText: {
    color: Colors.black,
    fontSize: 17,
    fontWeight: '700',
  },
  resendContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resendText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
  },
  resendButton: {
    padding: 6,
  },
  resendButtonText: {
    fontSize: 15,
    color: Colors.secondary,
    fontWeight: '600',
  },
  resendButtonDisabled: {
    color: Colors.gray,
    opacity: 0.5,
  },
  backToLoginButton: {
    alignSelf: 'center',
    padding: 10,
  },
  backToLoginText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  alertCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1C162E',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  alertIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(138, 43, 226, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  alertMessage: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  alertButton: {
    width: '100%',
    backgroundColor: '#8A2BE2',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  alertButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
