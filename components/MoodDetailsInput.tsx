import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';
import { MoodRating } from '../types';

interface MoodDetailsInputProps {
  onSubmit: (details: string) => Promise<void>;
  isVisible: boolean;
  moodRating: MoodRating;
  onGenerateRecommendations: () => Promise<void>;
}

export default function MoodDetailsInput({ 
  onSubmit, 
  isVisible, 
  moodRating, 
  onGenerateRecommendations 
}: MoodDetailsInputProps) {
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(false);

  // If not visible, don't render anything
  if (!isVisible) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // If there are details, submit them
      if (details.trim()) {
        await onSubmit(details);
        setDetails(''); // Clear input after successful submission
      } else {
        // If no details, just generate recommendations based on mood rating
        await onGenerateRecommendations();
      }
    } catch (error) {
      console.error('Error submitting mood details:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Get appropriate button text based on whether there are details
  const getButtonText = () => {
    if (details.trim()) {
      return "Update Recs";
    } else {
      return "Use Rating Only";
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[
          styles.headerContainer,
          isExpanded && styles.headerContainerExpanded
        ]} 
        onPress={toggleExpand}
        activeOpacity={0.7}
      >
        <View style={styles.headerContent}>
          <Ionicons 
            name="chatbubble-ellipses-outline" 
            size={20} 
            color={theme.colors.primary} 
          />
          <Text style={styles.headerText}>
            Tell us more about how you feel
          </Text>
        </View>
        <Ionicons 
          name={isExpanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color={theme.colors.subtext} 
        />
      </TouchableOpacity>
      
      {isExpanded && (
        <View style={styles.contentContainer}>
          <TextInput
            style={styles.input}
            value={details}
            onChangeText={setDetails}
            placeholder="Share your thoughts here..."
            placeholderTextColor={theme.colors.subtext + '80'}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={200}
          />
          
          <View style={styles.footer}>
            <Text style={styles.charCount}>
              {details.length}/200
            </Text>
            
            <TouchableOpacity 
              style={[
                styles.submitButton,
                isSubmitting && styles.submitButtonDisabled
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <Text style={styles.submitButtonText}>
                    {getButtonText()}
                  </Text>
                  <Ionicons 
                    name={details.trim() ? "refresh" : "checkmark-circle"} 
                    size={16} 
                    color="white" 
                    style={styles.sendIcon} 
                  />
                </>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.optionalText}>
            {details.trim() 
              ? "Your input will be used to personalize activity recommendations" 
              : "Without text, recommendations will be based on your mood rating only"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.small,
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 0,
    borderBottomColor: theme.colors.border,
  },
  headerContainerExpanded: {
    borderBottomWidth: 1,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerText: {
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    color: theme.colors.text,
    marginLeft: 8,
    flexShrink: 1,
  },
  contentContainer: {
    padding: 16,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.border,
    minHeight: 80,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  charCount: {
    fontSize: 12,
    color: theme.colors.subtext,
    alignSelf: 'center',
  },
  submitButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: theme.colors.primary + '80',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: theme.fontWeights.medium,
  },
  sendIcon: {
    marginLeft: 4,
  },
  optionalText: {
    fontSize: 12,
    color: theme.colors.subtext,
    marginTop: 8,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});