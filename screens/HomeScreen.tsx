import React, { useState, useEffect, useCallback } from 'react';
import { StyleSheet, Text, View, ScrollView, Dimensions, SafeAreaView, StatusBar, AppState, ActivityIndicator, TouchableOpacity } from 'react-native';
import { theme } from '../theme/theme';
import { Ionicons } from '@expo/vector-icons';
import MoodSlider from '../components/MoodSlider';
import ActivityCard from '../components/ActivityCard';
import MoodTrendGraph from '../components/MoodTrendGraph';
import QuoteComponent from '../components/QuoteComponent';
import Header from '../components/Header';
import ProfileModal from '../components/ProfileModal';
import PremiumFeatureBadge from '../components/PremiumFeatureBadge';
import { MoodRating, Activity } from '../types';
import { getTodayMoodEntry, getRecentMoodEntries, getMoodStreak, getWeeklyAverageMood, getCurrentWeekMoodEntries, getTodayDetailedMoodEntries } from '../services/moodService';
import { getCurrentUser, isAuthenticated } from '../services/authService';
import { getCurrentSubscriptionTier } from '../services/subscriptionService';
import { supabase } from '../utils/supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActivityRecommendations } from '../services/geminiService';

// Get screen dimensions
const { width: screenWidth } = Dimensions.get('window');

interface HomeScreenProps {
  onLogout: () => void;
  navigation: any;
}

export default function HomeScreen({ onLogout, navigation }: HomeScreenProps) {
  // State for selected mood (now can be null)
  const [selectedMood, setSelectedMood] = useState<MoodRating | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [weeklyAverage, setWeeklyAverage] = useState<number | null>(null);
  const [weeklyMoodEntries, setWeeklyMoodEntries] = useState<any[]>([]);
  const [todayMood, setTodayMood] = useState<MoodRating | null>(null);
  const [isSliderDisabled, setIsSliderDisabled] = useState(false);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [todayMoodEntries, setTodayMoodEntries] = useState<any[]>([]);
  const [hasMoodInput, setHasMoodInput] = useState(false);
  const [lastMoodDetails, setLastMoodDetails] = useState<string>('');
  
  // State for mood entries expansion
  const [showAllMoodEntries, setShowAllMoodEntries] = useState(false);
  
  // State for mood trend graph refresh
  const [trendGraphKey, setTrendGraphKey] = useState(0);
  
  // State for profile modal
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  
  // State to force quote refresh
  const [quoteKey, setQuoteKey] = useState(Date.now());
  
  // Memoized refresh mood data function
  const refreshMoodData = useCallback(async () => {
    try {
      console.log('Refreshing mood data...');
      
      // Check if user is authenticated
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error('Error getting session:', sessionError);
          return;
        }
        
        if (!session) {
          console.log('No active session found, skipping mood data refresh');
          return;
        }
        
        // Check subscription status
        const tier = await getCurrentSubscriptionTier();
        setIsPremium(tier === 'premium');
        
        // Get today's mood entry (summary)
        const todayEntry = await getTodayMoodEntry();
        
        if (todayEntry) {
          console.log('Today\'s mood entry found:', todayEntry);
          setTodayMood(todayEntry.rating);
          setSelectedMood(todayEntry.rating);
          setHasMoodInput(true);
          
          // Store the emotion details for potential refresh
          if (todayEntry.emotion_details) {
            setLastMoodDetails(todayEntry.emotion_details);
          } else {
            setLastMoodDetails('');
          }
          
          // Remove any stored last mood to ensure no fallback
          await AsyncStorage.removeItem('last_mood_rating');
          
          // Generate recommendations based on the latest mood entry
          if (todayEntry.emotion_details && todayEntry.emotion_details.trim() !== '') {
            // If there are details, use them for recommendations
            await generateRecommendationsWithDetails(todayEntry.rating, todayEntry.emotion_details);
          } else {
            // Otherwise, use just the mood rating
            await generateRecommendationsBasedOnMood(todayEntry.rating);
          }
        } else {
          console.log('No mood entry found for today');
          
          // No fallback - set to null
          setSelectedMood(null);
          setTodayMood(null);
          setHasMoodInput(false);
          setActivities(null);
          setLastMoodDetails('');
          
          // Remove any stored last mood to ensure no fallback
          await AsyncStorage.removeItem('last_mood_rating');
        }
        
        // For premium users, get detailed entries for today
        if (tier === 'premium') {
          const detailedEntries = await getTodayDetailedMoodEntries();
          setTodayMoodEntries(detailedEntries);
          console.log(`Found ${detailedEntries.length} detailed mood entries for today`);
        }
        
        // Get all mood entries for streak calculation
        const { data: allEntries, error: entriesError } = await supabase
          .from('mood_entries')
          .select('*')
          .eq('user_id', session.user.id)
          .order('date', { ascending: false });
        
        if (entriesError) {
          console.error('Error fetching all mood entries:', entriesError);
        } else {
          // Calculate streak
          let currentStreak = 0;
          if (allEntries && allEntries.length > 0) {
            // Simple streak calculation
            currentStreak = 1; // Start with 1 for the most recent entry
            
            // Create a map of dates with entries
            const dateMap = new Map();
            allEntries.forEach(entry => {
              dateMap.set(entry.date, true);
            });
            
            // Get the most recent entry date
            const mostRecentDate = new Date(allEntries[0].date);
            
            // Check previous days
            for (let i = 1; i <= 365; i++) { // Check up to a year back
              const prevDate = new Date(mostRecentDate);
              prevDate.setDate(prevDate.getDate() - i);
              const dateStr = prevDate.toISOString().split('T')[0];
              
              if (dateMap.has(dateStr)) {
                currentStreak++;
              } else {
                break;
              }
            }
          }
          
          console.log('Current streak:', currentStreak);
          setStreak(currentStreak);
          
          // Get weekly entries (last 7 days)
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const startDate = sevenDaysAgo.toISOString().split('T')[0];
          const today = new Date().toISOString().split('T')[0];
          
          const weekEntries = allEntries.filter(entry => 
            entry.date >= startDate && entry.date <= today
          );
          
          console.log('Weekly entries:', weekEntries);
          setWeeklyMoodEntries(weekEntries);
          
          // Calculate weekly average
          if (weekEntries.length > 0) {
            const sum = weekEntries.reduce((total, entry) => total + entry.rating, 0);
            const avg = sum / weekEntries.length;
            console.log('Weekly average:', avg);
            setWeeklyAverage(avg);
          } else {
            setWeeklyAverage(null);
          }
        }
        
        // Force mood trend graph to refresh
        setTrendGraphKey(prev => prev + 1);
        
        console.log('Mood data refresh complete');
      } catch (sessionError) {
        console.error('Error checking session:', sessionError);
      }
    } catch (error) {
      console.error('Error refreshing mood data:', error);
    }
  }, []);
  
  // Generate recommendations based on mood rating without text input
  const generateRecommendationsBasedOnMood = async (moodRating: MoodRating) => {
    try {
      setIsLoadingActivities(true);
      
      // Get recent mood entries to provide context
      const recentEntries = await getRecentMoodEntries(7);
      
      // Get personalized activity recommendations from Gemini
      const recommendedActivities = await getActivityRecommendations(moodRating, "");
      setActivities(recommendedActivities);
    } catch (error) {
      console.error('Error getting activity recommendations based on mood:', error);
      // Set activities to null on error
      setActivities(null);
    } finally {
      setIsLoadingActivities(false);
    }
  };
  
  // Generate recommendations with mood details
  const generateRecommendationsWithDetails = async (moodRating: MoodRating, details: string) => {
    try {
      setIsLoadingActivities(true);
      
      // Get personalized activity recommendations from Gemini
      const recommendedActivities = await getActivityRecommendations(moodRating, details);
      setActivities(recommendedActivities);
    } catch (error) {
      console.error('Error getting activity recommendations with details:', error);
      // Set activities to null on error
      setActivities(null);
    } finally {
      setIsLoadingActivities(false);
    }
  };
  
  // Refresh recommendations based on latest input
  const refreshRecommendations = async () => {
    if (!todayMood) return;
    
    setIsLoadingActivities(true);
    try {
      if (lastMoodDetails && lastMoodDetails.trim() !== '') {
        // If there are details, use them for recommendations
        await generateRecommendationsWithDetails(todayMood, lastMoodDetails);
      } else {
        // Otherwise, use just the mood rating
        await generateRecommendationsBasedOnMood(todayMood);
      }
    } catch (error) {
      console.error('Error refreshing recommendations:', error);
      setActivities(null);
    } finally {
      setIsLoadingActivities(false);
    }
  };
  
  // Load user data and mood information
  useEffect(() => {
    const loadUserData = async () => {
      setIsLoading(true);
      try {
        const isLoggedIn = await isAuthenticated();
        if (!isLoggedIn) {
          // Handle not authenticated state
          console.log('User not authenticated');
          onLogout();
          setIsLoading(false);
          return;
        }
        
        // Try to get stored display name first
        const storedName = await AsyncStorage.getItem('user_display_name');
        
        const user = await getCurrentUser();
        if (user) {
          // Use stored name if available, otherwise use a generic name
          if (storedName) {
            setUserName(storedName);
          } else {
            // Use a generic name instead of email
            setUserName('Friend');
            // Store the generic name for future use
            await AsyncStorage.setItem('user_display_name', 'Friend');
          }
          
          // Check subscription status
          try {
            const tier = await getCurrentSubscriptionTier();
            setIsPremium(tier === 'premium');
          } catch (error) {
            console.error('Error checking subscription status:', error);
            setIsPremium(false);
          }
          
          // Load mood data
          await refreshMoodData();
        }
      } catch (error) {
        console.error('Error loading user data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadUserData();
    
    // Listen for app state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        // App has come to the foreground, refresh data
        refreshMoodData();
        setQuoteKey(Date.now());
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshMoodData, onLogout]);
  
  // Handle mood change
  const handleMoodChange = (mood: MoodRating | null) => {
    console.log('Mood changed in HomeScreen:', mood);
    setSelectedMood(mood);
    
    // Only update todayMood if a mood has been saved for today
    // This ensures the "Today" indicator only shows saved moods
    if (todayMood !== null) {
      setTodayMood(mood);
    }
  };
  
  // Handle mood saved
  const handleMoodSaved = async () => {
    console.log('Mood saved, refreshing data...');
    // Refresh all mood data when a new mood is saved
    await refreshMoodData();
    setHasMoodInput(true);
  };
  
  // Handle mood details submission
  const handleMoodDetailsSubmitted = async (rating: MoodRating, details: string) => {
    console.log('Mood details submitted:', { rating, details });
    setIsLoadingActivities(true);
    
    try {
      // Store the latest mood details
      setLastMoodDetails(details);
      
      // Get personalized activity recommendations from Gemini
      const recommendedActivities = await getActivityRecommendations(rating, details);
      setActivities(recommendedActivities);
      setHasMoodInput(true);
    } catch (error) {
      console.error('Error getting activity recommendations:', error);
      // Set activities to null on error
      setActivities(null);
    } finally {
      setIsLoadingActivities(false);
    }
  };
  
  // Handle profile button press
  const handleProfilePress = () => {
    setProfileModalVisible(true);
  };
  
  // Handle profile modal close
  const handleProfileModalClose = () => {
    setProfileModalVisible(false);
    
    // Refresh user name when profile modal is closed (in case it was updated)
    const refreshUserName = async () => {
      const storedName = await AsyncStorage.getItem('user_display_name');
      if (storedName) {
        setUserName(storedName);
      }
    };
    
    refreshUserName();
    
    // Refresh data when profile modal is closed (in case settings were changed)
    refreshMoodData();
    
    // Check subscription status again
    const checkSubscription = async () => {
      try {
        const tier = await getCurrentSubscriptionTier();
        setIsPremium(tier === 'premium');
      } catch (error) {
        console.error('Error checking subscription status:', error);
      }
    };
    
    checkSubscription();
  };
  
  // Handle premium feature button press
  const handlePremiumFeaturePress = (featureName: string) => {
    if (isPremium) {
      // If user is premium, navigate to the feature
      if (featureName === 'GuidedExercises') {
        navigation.navigate('GuidedExercises', { isPremium });
      } else if (featureName === 'StreakRewards') {
        navigation.navigate('StreakRewards', { isPremium });
      } else if (featureName === 'MoodPredictions') {
        navigation.navigate('MoodPredictions', { isPremium });
      } else {
        // For other features, just log the action for now
        console.log(`Premium feature pressed: ${featureName}`);
      }
    } else {
      // If user is not premium, navigate to subscription comparison screen
      navigation.navigate('SubscriptionComparison', { source: 'upgrade' });
    }
  };
  
  // Navigate to subscription screen (direct method)
  const navigateToSubscription = () => {
    navigation.navigate('SubscriptionComparison', { source: 'upgrade' });
  };
  
  // Toggle showing all mood entries
  const toggleMoodEntries = () => {
    setShowAllMoodEntries(!showAllMoodEntries);
  };
  
  function getMoodEmoji(rating: number | null): string {
    if (rating === null) return '–';
    switch (rating) {
      case 1: return '😢';
      case 2: return '😕';
      case 3: return '😐';
      case 4: return '🙂';
      case 5: return '😄';
      default: return '–';
    }
  }
  
  function getMoodColor(rating: number | null): string {
    if (rating === null) return theme.colors.text;
    switch (rating) {
      case 1: return theme.colors.mood1;
      case 2: return theme.colors.mood2;
      case 3: return theme.colors.mood3;
      case 4: return theme.colors.mood4;
      case 5: return theme.colors.mood5;
      default: return theme.colors.text;
    }
  }
  
  // Format time for display
  function formatTime(timeString: string): string {
    try {
      const time = new Date(`2000-01-01T${timeString}`);
      return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return timeString;
    }
  }
  
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="light-content" backgroundColor={theme.colors.background} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading your mood data...</Text>
        </View>
      </SafeAreaView>
    );
  }
  
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.background} />
      
      <Header onProfilePress={handleProfilePress} />
      
      <ScrollView 
        style={styles.container} 
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Hey {userName},</Text>
          <Text style={styles.subGreeting}>let's make today great! ✨</Text>
          <Text style={styles.date}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>
        
        <QuoteComponent key={quoteKey} />
        
        {/* Mood Check-in Section - Moved above premium features */}
        <View style={styles.moodCheckInContainer}>
          <Text style={styles.sectionTitle}>How are you feeling today?</Text>
          <MoodSlider 
            value={selectedMood} 
            onValueChange={handleMoodChange}
            onMoodSaved={handleMoodSaved}
            onMoodDetailsSubmitted={handleMoodDetailsSubmitted}
            disabled={isSliderDisabled}
          />
        </View>
        
        {/* Premium Features Section */}
        <View style={styles.premiumFeaturesContainer}>
          {/* Guided Exercises & Meditations Button */}
          <TouchableOpacity 
            style={styles.premiumFeatureButton}
            onPress={() => {
              if (isPremium) {
                navigation.navigate('GuidedExercises', { isPremium });
              } else {
                navigateToSubscription();
              }
            }}
          >
            <View style={styles.premiumFeatureContent}>
              <View style={styles.premiumFeatureIconContainer}>
                <Ionicons name="flower-outline" size={24} color={theme.colors.background} />
              </View>
              <View style={styles.premiumFeatureTextContainer}>
                <Text style={styles.premiumFeatureTitle}>Guided Exercises & Meditations</Text>
                <Text style={styles.premiumFeatureSubtitle}>
                  Exclusive content tailored to your moods
                </Text>
              </View>
              {!isPremium && (
                <PremiumFeatureBadge
                  featureName="Guided Exercises & Meditations"
                  featureDescription="Access our library of guided exercises and meditations tailored to your specific moods. Perfect for managing stress, anxiety, and improving your overall wellbeing."
                  onUpgrade={navigateToSubscription}
                  small
                />
              )}
              <Ionicons name="chevron-forward" size={20} color={theme.colors.text} />
            </View>
          </TouchableOpacity>
          
          {/* Streak Rewards Button */}
          <TouchableOpacity 
            style={styles.premiumFeatureButton}
            onPress={() => {
              if (isPremium) {
                navigation.navigate('StreakRewards', { isPremium });
              } else {
                navigateToSubscription();
              }
            }}
          >
            <View style={styles.premiumFeatureContent}>
              <View style={[styles.premiumFeatureIconContainer, { backgroundColor: theme.colors.accent }]}>
                <Ionicons name="trophy-outline" size={24} color={theme.colors.background} />
              </View>
              <View style={styles.premiumFeatureTextContainer}>
                <Text style={styles.premiumFeatureTitle}>Streak Rewards</Text>
                <Text style={styles.premiumFeatureSubtitle}>
                  {isPremium ? 'Special badges, streak recovery options' : 'Unlock more rewards with premium'}
                </Text>
              </View>
              {!isPremium && (
                <PremiumFeatureBadge
                  featureName="Premium Streak Rewards"
                  featureDescription="Unlock special badges, achievements, and streak recovery options with a premium subscription."
                  onUpgrade={navigateToSubscription}
                  small
                />
              )}
              <Ionicons name="chevron-forward" size={20} color={theme.colors.text} />
            </View>
          </TouchableOpacity>
          
          {/* AI Mood Predictions Button */}
          <TouchableOpacity 
            style={styles.premiumFeatureButton}
            onPress={() => {
              if (isPremium) {
                navigation.navigate('MoodPredictions', { isPremium });
              } else {
                navigateToSubscription();
              }
            }}
          >
            <View style={styles.premiumFeatureContent}>
              <View style={[styles.premiumFeatureIconContainer, { backgroundColor: '#9C27B0' }]}>
                <Ionicons name="analytics-outline" size={24} color={theme.colors.background} />
              </View>
              <View style={styles.premiumFeatureTextContainer}>
                <Text style={styles.premiumFeatureTitle}>AI Mood Predictions</Text>
                <Text style={styles.premiumFeatureSubtitle}>
                  Get insights into future mood trends
                </Text>
              </View>
              {!isPremium && (
                <PremiumFeatureBadge
                  featureName="AI Mood Predictions"
                  featureDescription="Our AI analyzes your mood patterns to predict future trends and provide personalized insights to help you prepare for potential mood changes."
                  onUpgrade={navigateToSubscription}
                  small
                />
              )}
              <Ionicons name="chevron-forward" size={20} color={theme.colors.text} />
            </View>
          </TouchableOpacity>
        </View>
        
        <View style={styles.moodSummaryContainer}>
          <Text style={styles.sectionTitle}>Your Mood Summary</Text>
          
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Today</Text>
                <Text style={[
                  styles.summaryValue,
                  { color: getMoodColor(todayMood) }
                ]}>
                  {getMoodEmoji(todayMood)}
                </Text>
              </View>
              
              <View style={styles.divider} />
              
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Weekly Mood</Text>
                <Text style={[
                  styles.summaryValue,
                  { color: getMoodColor(weeklyAverage ? Math.round(weeklyAverage) : null) }
                ]}>
                  {weeklyAverage ? getMoodEmoji(Math.round(weeklyAverage) as MoodRating) : '–'}
                </Text>
              </View>
              
              <View style={styles.divider} />
              
              <TouchableOpacity 
                style={styles.summaryItem}
                onPress={() => {
                  if (isPremium) {
                    navigation.navigate('StreakRewards', { isPremium });
                  } else {
                    navigateToSubscription();
                  }
                }}
              >
                <Text style={styles.summaryLabel}>Streak</Text>
                <Text style={[styles.summaryValue, styles.streakValue]} numberOfLines={1}>
                  {streak} {streak === 1 ? 'day' : 'days'}
                </Text>
              </TouchableOpacity>
            </View>
            
            {/* For premium users, show detailed mood entries for today */}
            {isPremium && todayMoodEntries.length > 0 && (
              <View style={styles.detailedMoodContainer}>
                <View style={styles.detailedMoodHeader}>
                  <Text style={styles.detailedMoodTitle}>Today's Mood Entries</Text>
                  {todayMoodEntries.length > 4 && (
                    <TouchableOpacity 
                      style={styles.viewMoreButton}
                      onPress={toggleMoodEntries}
                    >
                      <Text style={styles.viewMoreButtonText}>
                        {showAllMoodEntries ? 'Collapse' : 'View All'}
                      </Text>
                      <Ionicons 
                        name={showAllMoodEntries ? 'chevron-up' : 'chevron-down'} 
                        size={16} 
                        color={theme.colors.primary} 
                      />
                    </TouchableOpacity>
                  )}
                </View>
                
                <View style={styles.detailedMoodList}>
                  {/* Show either all entries or just the first 4 */}
                  {(showAllMoodEntries ? todayMoodEntries : todayMoodEntries.slice(0, 4)).map((entry, index) => (
                    <View key={entry.id} style={styles.detailedMoodItem}>
                      <Text style={styles.detailedMoodTime}>{formatTime(entry.time)}</Text>
                      <Text style={[
                        styles.detailedMoodEmoji,
                        { color: getMoodColor(entry.rating) }
                      ]}>
                        {getMoodEmoji(entry.rating)}
                      </Text>
                      {entry.note && (
                        <Text style={styles.detailedMoodNote} numberOfLines={1} ellipsizeMode="tail">
                          {entry.note}
                        </Text>
                      )}
                    </View>
                  ))}
                  
                  {/* Show indicator of hidden entries if not expanded */}
                  {!showAllMoodEntries && todayMoodEntries.length > 4 && (
                    <View style={styles.hiddenEntriesIndicator}>
                      <Text style={styles.hiddenEntriesText}>
                        +{todayMoodEntries.length - 4} more entries
                      </Text>
                    </View>
                  )}
                </View>
                
                <Text style={styles.detailedMoodAverage}>
                  Daily Average: {getMoodEmoji(todayMood)} ({todayMoodEntries.length} {todayMoodEntries.length === 1 ? 'entry' : 'entries'})
                </Text>
              </View>
            )}
            
            <View style={styles.trendContainer}>
              <Text style={styles.trendTitle}>Your Mood Trend</Text>
              <MoodTrendGraph key={trendGraphKey} days={5} />
            </View>
          </View>
        </View>
        
        <View style={styles.activitiesContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recommended Activities</Text>
            {hasMoodInput && (
              <TouchableOpacity 
                style={styles.refreshButton}
                onPress={refreshRecommendations}
                disabled={isLoadingActivities}
              >
                <Ionicons 
                  name="refresh" 
                  size={20} 
                  color={theme.colors.primary} 
                  style={isLoadingActivities ? styles.spinningIcon : undefined}
                />
              </TouchableOpacity>
            )}
          </View>
          
          {hasMoodInput ? (
            <>
              <Text style={styles.sectionSubtitle}>
                {lastMoodDetails.trim() !== '' ? 
                  "Based on how you described your mood" : 
                  "Based on your mood rating"}
              </Text>
              
              {isLoadingActivities ? (
                <View style={styles.activitiesLoadingContainer}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={styles.activitiesLoadingText}>Personalizing your recommendations...</Text>
                </View>
              ) : activities && activities.length > 0 ? (
                activities.map(activity => (
                  <View key={activity.id} style={styles.activityItem}>
                    <ActivityCard 
                      activity={activity} 
                      isPremiumUser={isPremium}
                      onPress={() => {
                        // If this is a premium activity and user is not premium, show subscription screen
                        if (activity.isPremium && !isPremium) {
                          navigateToSubscription();
                        } else {
                          // Otherwise handle the activity normally
                          console.log('Activity pressed:', activity.title);
                        }
                      }}
                    />
                  </View>
                ))
              ) : (
                <View style={styles.noActivitiesContainer}>
                  <Ionicons name="refresh-circle-outline" size={40} color={theme.colors.subtext} />
                  <Text style={styles.noActivitiesText}>
                    Unable to load recommendations. Please try again later.
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.noMoodInputContainer}>
              <Ionicons name="arrow-up-circle-outline" size={40} color={theme.colors.primary} />
              <Text style={styles.noMoodInputText}>
                Log your mood above to get personalized activity recommendations
              </Text>
              <Text style={styles.noMoodInputSubtext}>
                Your recommendations will be based on how you're feeling today
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
      
      <ProfileModal 
        visible={profileModalVisible} 
        onClose={handleProfileModalClose}
        onLogout={onLogout}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    paddingHorizontal: screenWidth * 0.05, // 5% of screen width for horizontal padding
    paddingTop: 0, // Reduced because we now have a header
    paddingBottom: 32,
  },
  header: {
    marginBottom: 16,
  },
  greeting: {
    fontSize: 28,
    fontWeight: theme.fontWeights.bold,
    color: theme.colors.text,
    lineHeight: 34,
  },
  subGreeting: {
    fontSize: 22,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text,
    marginBottom: 4,
    lineHeight: 28,
  },
  date: {
    fontSize: 16,
    color: theme.colors.subtext,
    marginTop: 4,
    lineHeight: 22,
  },
  // Premium Features Section
  premiumFeaturesContainer: {
    marginBottom: 24,
  },
  premiumFeatureButton: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    marginBottom: 12,
    ...theme.shadows.medium,
  },
  premiumFeatureContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  premiumFeatureIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  premiumFeatureTextContainer: {
    flex: 1,
    paddingRight: 8,
  },
  premiumFeatureTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeights.bold,
    color: theme.colors.text,
    lineHeight: 22,
  },
  premiumFeatureSubtitle: {
    fontSize: 14,
    color: theme.colors.subtext,
    marginTop: 2,
    lineHeight: 20,
  },
  streakContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  moodCheckInContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: theme.fontWeights.bold,
    color: theme.colors.text,
    marginBottom: 12,
    lineHeight: 26,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.small,
    marginBottom: 8,
  },
  spinningIcon: {
    opacity: 0.6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: theme.colors.subtext,
    marginTop: -8,
    marginBottom: 16,
    lineHeight: 20,
  },
  moodSummaryContainer: {
    marginBottom: 24,
  },
  summaryCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 16,
    ...theme.shadows.medium,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: theme.colors.subtext,
    marginBottom: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: theme.fontWeights.bold,
    lineHeight: 34,
    textAlign: 'center',
  },
  streakValue: {
    color: theme.colors.accent,
    fontSize: 18, // Reduced from 28 to fit "days" on one line
    lineHeight: 24, // Adjusted to match new font size
    width: '100%', // Ensure the text takes full width
  },
  divider: {
    width: 1,
    backgroundColor: theme.colors.border,
    marginHorizontal: 8,
  },
  trendContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text,
    marginBottom: 8,
    lineHeight: 22,
  },
  activitiesContainer: {
    marginBottom: 16,
  },
  activityItem: {
    marginBottom: 12,
  },
  activitiesLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    marginBottom: 12,
  },
  activitiesLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: theme.colors.subtext,
    textAlign: 'center',
    lineHeight: 20,
  },
  noMoodInputContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    marginBottom: 12,
    minHeight: 150,
  },
  noMoodInputText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: theme.fontWeights.medium,
    color: theme.colors.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  noMoodInputSubtext: {
    marginTop: 8,
    fontSize: 14,
    color: theme.colors.subtext,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  noActivitiesContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    marginBottom: 12,
    minHeight: 150,
  },
  noActivitiesText: {
    marginTop: 12,
    fontSize: 16,
    color: theme.colors.subtext,
    textAlign: 'center',
    lineHeight: 22,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: theme.colors.subtext,
    textAlign: 'center',
    lineHeight: 22,
  },
  // Detailed mood entries styles
  detailedMoodContainer: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
  },
  detailedMoodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  detailedMoodTitle: {
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text,
    lineHeight: 22,
  },
  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.primary + '15',
    borderRadius: 12,
  },
  viewMoreButtonText: {
    fontSize: 12,
    fontWeight: theme.fontWeights.medium,
    color: theme.colors.primary,
    marginRight: 4,
    lineHeight: 18,
  },
  detailedMoodList: {
    marginBottom: 12,
  },
  detailedMoodItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
  },
  detailedMoodTime: {
    fontSize: 14,
    color: theme.colors.subtext,
    width: 70,
    lineHeight: 20,
  },
  detailedMoodEmoji: {
    fontSize: 20,
    marginHorizontal: 12,
    lineHeight: 26,
  },
  detailedMoodNote: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    paddingRight: 4,
  },
  detailedMoodAverage: {
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 20,
    paddingHorizontal: 10,
  },
  hiddenEntriesIndicator: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: theme.colors.background + '80',
    borderRadius: 8,
    marginTop: 4,
  },
  hiddenEntriesText: {
    fontSize: 12,
    color: theme.colors.subtext,
    fontStyle: 'italic',
    lineHeight: 18,
  },
});