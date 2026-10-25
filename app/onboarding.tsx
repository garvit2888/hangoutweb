import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ScrollView, Platform, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import Colors from '@/constants/colors';
import { useUserStore } from '@/store/userStore';
import { doc, updateDoc, setDoc } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { auth, db } from '@/config/firebase';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, AlertCircle } from 'lucide-react-native';

const NAME_PART_REGEX = /^[A-Za-z][A-Za-z'-]*$/;
const VOWEL_REGEX = /[AEIOUYaeiouy]/;

type NameValidationResult =
  | { valid: true; value: string }
  | { valid: false; error: string };

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const toTitleCase = (value: string) =>
  value
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const validateFullNameInput = (rawValue: string): NameValidationResult => {
  const normalized = normalizeWhitespace(rawValue);

  if (!normalized) {
    return { valid: false, error: 'Please enter your name' };
  }

  if (normalized.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters long' };
  }

  return { valid: true, value: toTitleCase(normalized) };
};

export default function OnboardingScreen() {
  const router = useRouter();
  const { setProfile, loginEmail } = useUserStore();
  const [formData, setFormData] = useState({
    fullName: '',
    gender: '',
    dateOfBirth: '31/12/1999',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(1999, 11, 31)); // Default to 31/12/1999 (18+)
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
  }>({
    visible: false,
    title: '',
    message: '',
  });

  const showAlert = (title: string, message: string) => {
    setAlertConfig({ visible: true, title, message });
    if (Platform.OS !== 'web') {
      Alert.alert(title, message);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    if (field === 'fullName') {
      value = value.replace(/[^A-Za-z\s'-]/g, '');
    }
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const formatDate = (date: Date): string => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const handleDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }

    if (date) {
      setSelectedDate(date);
      const formattedDate = formatDate(date);
      handleInputChange('dateOfBirth', formattedDate);
    }
  };

  const handleDatePickerDone = (customDate?: Date) => {
    const dateToUse = customDate || selectedDate;
    const formatted = formatDate(dateToUse);
    handleInputChange('dateOfBirth', formatted);
    setShowDatePicker(false);
  };

  const handleDatePickerPress = () => {
    if (formData.dateOfBirth) {
      const dateParts = formData.dateOfBirth.split('/');
      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);
        setSelectedDate(new Date(year, month, day));
      }
    } else {
      const defaultD = new Date(1999, 11, 31);
      setSelectedDate(defaultD);
      handleInputChange('dateOfBirth', formatDate(defaultD));
    }
    setShowDatePicker(true);
  };

  const validateForm = (): { fullName: string } | null => {
    if (formData.fullName !== formData.fullName.trim()) {
      showAlert('Invalid Input', 'Full name cannot contain leading or trailing spaces.');
      return null;
    }

    const nameValidation = validateFullNameInput(formData.fullName);
    if (!nameValidation.valid) {
      showAlert('Invalid Name', nameValidation.error);
      return null;
    }
    if (!formData.gender) {
      showAlert('Missing Selection', 'Please select your gender');
      return null;
    }
    if (!formData.dateOfBirth.trim()) {
      showAlert('Missing Date', 'Please enter your date of birth');
      return null;
    }

    // Age Verification
    const [day, month, year] = formData.dateOfBirth.split('/').map(num => parseInt(num, 10));
    const birthDate = new Date(year, month - 1, day);
    const today = new Date();

    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      showAlert(
        'Age Restriction',
        'You must be at least 18 years of age to use this app.'
      );
      return null;
    }

    return { fullName: nameValidation.value };
  };

  const handleContinue = async () => {
    const validationResult = validateForm();
    if (!validationResult) return;

    const sanitizedFullName = validationResult.fullName;
    setIsLoading(true);

    try {
      let userToUse = auth.currentUser;
      if (!userToUse) {
        try {
          const cred = await signInAnonymously(auth);
          userToUse = cred.user;
        } catch (anonErr) {
          console.warn('Anonymous sign-in note:', anonErr);
        }
      }

      const uid = userToUse?.uid || (loginEmail ? `user_${loginEmail.replace(/[^a-zA-Z0-9]/g, '_')}` : `user_${Date.now()}`);
      const email = loginEmail || userToUse?.email || 'user@example.com';
      const newProfile = {
        fullName: sanitizedFullName,
        email,
        gender: formData.gender,
        dateOfBirth: formData.dateOfBirth,
        isEmailVerified: false,
        isPhotoVerified: false,
        hasCompletedOnboarding: false,
        uid,
      };

      try {
        await setDoc(doc(db, 'users', uid), {
          ...newProfile,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        console.log('✅ ONBOARDING: Saved profile to Firestore:', newProfile);
      } catch (firestoreErr) {
        console.warn('Firestore write note (saving locally):', firestoreErr);
      }

      setProfile(newProfile);
      setFormData(prev => ({ ...prev, fullName: sanitizedFullName }));

      router.push('/email-verification');
    } catch (error: any) {
      console.error('Onboarding error:', error);
      showAlert('Error', error?.message || 'Failed to save profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[Colors.primary, Colors.darkPurple]}
      style={styles.container}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>Tell us a bit about yourself</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your full name"
                placeholderTextColor={Colors.gray}
                value={formData.fullName}
                onChangeText={(value) => handleInputChange('fullName', value)}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Date of Birth</Text>

              {Platform.OS === 'web' ? (
                <View style={styles.dateInputContainer}>
                  <View style={styles.dateInput}>
                    <Calendar size={20} color={formData.dateOfBirth ? Colors.white : Colors.gray} />
                    <input
                      type="date"
                      value={
                        formData.dateOfBirth
                          ? `${formData.dateOfBirth.split('/')[2]}-${formData.dateOfBirth.split('/')[1]}-${formData.dateOfBirth.split('/')[0]}`
                          : selectedDate.toISOString().slice(0, 10)
                      }
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e: any) => {
                        if (e.target?.value) {
                          const [year, month, day] = e.target.value.split('-').map(Number);
                          const newDate = new Date(year, month - 1, day);
                          setSelectedDate(newDate);
                          const formatted = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
                          handleInputChange('dateOfBirth', formatted);
                        }
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: '#FFFFFF',
                        fontSize: 16,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        colorScheme: 'dark',
                      }}
                    />
                  </View>
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.dateInputContainer}
                    onPress={handleDatePickerPress}
                    activeOpacity={0.7}
                  >
                    <View style={styles.dateInput}>
                      <Calendar size={20} color={formData.dateOfBirth ? Colors.white : Colors.gray} />
                      <Text style={[styles.dateInputText, !formData.dateOfBirth && styles.dateInputPlaceholder]}>
                        {formData.dateOfBirth || 'Select your date of birth'}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {showDatePicker && (
                    <DateTimePicker
                      value={selectedDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleDateChange}
                      maximumDate={new Date()}
                      minimumDate={new Date(1900, 0, 1)}
                      style={Platform.OS === 'android' ? {} : styles.datePickerIOS}
                    />
                  )}

                  {Platform.OS === 'ios' && showDatePicker && (
                    <View style={styles.iosPickerButtons}>
                      <TouchableOpacity
                        style={styles.iosPickerButton}
                        onPress={() => handleDatePickerDone()}
                      >
                        <Text style={styles.iosPickerButtonText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Gender</Text>
              <View style={styles.genderContainer}>
                {['Male', 'Female', 'Non-binary', 'Prefer not to say'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.genderOption,
                      formData.gender === option && styles.genderOptionSelected,
                    ]}
                    onPress={() => handleInputChange('gender', option)}
                  >
                    <Text
                      style={[
                        styles.genderText,
                        formData.gender === option && styles.genderTextSelected,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.continueButton, isLoading && styles.continueButtonDisabled]}
            onPress={handleContinue}
            disabled={isLoading}
          >
            <Text style={styles.continueButtonText}>
              {isLoading ? 'Creating Account...' : 'Continue'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Custom Universal Alert Modal (Works reliably on Web, iOS, Android) */}
      <Modal
        visible={alertConfig.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.alertOverlay}>
          <View style={styles.alertCard}>
            <View style={styles.alertIconCircle}>
              <AlertCircle size={32} color={Colors.secondary} />
            </View>
            <Text style={styles.alertTitle}>{alertConfig.title}</Text>
            <Text style={styles.alertMessage}>{alertConfig.message}</Text>
            <TouchableOpacity
              style={styles.alertButton}
              onPress={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
              activeOpacity={0.8}
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
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    maxWidth: 540,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.secondary,
    textAlign: 'center',
  },
  form: {
    flex: 1,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.white,
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.white,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  dateInputContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  dateInputText: {
    fontSize: 16,
    color: Colors.white,
    flex: 1,
  },
  dateInputPlaceholder: {
    color: Colors.gray,
  },
  datePickerIOS: {
    height: 200,
    marginTop: 10,
  },
  iosPickerButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  iosPickerButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Colors.secondary,
    borderRadius: 8,
  },
  iosPickerButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '600',
  },
  genderContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  genderOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  genderOptionSelected: {
    backgroundColor: Colors.secondary,
    borderColor: Colors.secondary,
  },
  genderText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  genderTextSelected: {
    color: Colors.black,
  },
  continueButton: {
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  continueButtonDisabled: {
    backgroundColor: Colors.gray,
  },
  continueButtonText: {
    color: Colors.black,
    fontSize: 18,
    fontWeight: 'bold',
  },
  alertOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  alertCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1E2433',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.6,
    shadowRadius: 32,
    elevation: 24,
  },
  alertIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
    textAlign: 'center',
    marginBottom: 8,
  },
  alertMessage: {
    fontSize: 15,
    color: '#D1D5DB',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  alertButton: {
    backgroundColor: Colors.secondary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 14,
    minWidth: 140,
    alignItems: 'center',
  },
  alertButtonText: {
    color: Colors.black,
    fontSize: 16,
    fontWeight: '700',
  },
});
