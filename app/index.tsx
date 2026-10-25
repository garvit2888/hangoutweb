import React, { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import SplashScreenComponent from '@/components/SplashScreen';
import { useAuth } from '@/hooks/useAuth';

export default function SplashScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [animationComplete, setAnimationComplete] = useState(false);

  useEffect(() => {
    // Wait for both animation to finish AND auth state to resolve
    if (animationComplete && !loading) {
      if (user) {
        // User is logged in, go to main app (Maps)
        router.replace('/(tabs)/map');
      } else {
        // User is not logged in, go to login
        router.replace('/login');
      }
    }
  }, [animationComplete, loading, user, router]);

  return <SplashScreenComponent onAnimationComplete={() => setAnimationComplete(true)} />;
}
