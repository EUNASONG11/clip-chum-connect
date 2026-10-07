export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookmarks: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          note: string | null
          seconds: number
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          note?: string | null
          seconds?: number
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          note?: string | null
          seconds?: number
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookmarks_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      class_categories: {
        Row: {
          cohort: string | null
          color: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          cohort?: string | null
          color?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          cohort?: string | null
          color?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      class_enrollment_history: {
        Row: {
          action: string
          actor_id: string | null
          class_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          class_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          class_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_enrollment_history_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_folders: {
        Row: {
          class_id: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_required: boolean
          name: string
          parent_folder_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_required?: boolean
          name: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_required?: boolean
          name?: string
          parent_folder_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_folders_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "class_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      class_instructors: {
        Row: {
          class_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          instructor_user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          instructor_user_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          instructor_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_instructors_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_students: {
        Row: {
          class_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          progress_start_at: string | null
          user_id: string
        }
        Insert: {
          class_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          progress_start_at?: string | null
          user_id: string
        }
        Update: {
          class_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          progress_start_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          active_from: string | null
          active_to: string | null
          branch: string | null
          category_id: string | null
          class_type: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          branch?: string | null
          category_id?: string | null
          class_type?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          branch?: string | null
          category_id?: string | null
          class_type?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "class_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      external_assignment_completions: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          link_id: string
          occurred_at: string
          remote_status: string | null
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          link_id: string
          occurred_at?: string
          remote_status?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          link_id?: string
          occurred_at?: string
          remote_status?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_assignment_completions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "external_assignment_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_assignment_completions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      external_assignment_links: {
        Row: {
          assignment_type: string
          class_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          external_id: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          period_end: string | null
          period_start: string | null
          remote_assignment_type_id: string | null
          scope: string
          source: string
          student_count: number
          updated_at: string
          video_id: string | null
          week_label: string | null
        }
        Insert: {
          assignment_type: string
          class_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          external_id: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          period_end?: string | null
          period_start?: string | null
          remote_assignment_type_id?: string | null
          scope?: string
          source?: string
          student_count?: number
          updated_at?: string
          video_id?: string | null
          week_label?: string | null
        }
        Update: {
          assignment_type?: string
          class_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          external_id?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          period_end?: string | null
          period_start?: string | null
          remote_assignment_type_id?: string | null
          scope?: string
          source?: string
          student_count?: number
          updated_at?: string
          video_id?: string | null
          week_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_assignment_links_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_assignment_links_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      external_students: {
        Row: {
          auth_user_id: string | null
          branch: string | null
          class_time: string | null
          cohort: string | null
          created_at: string
          enrollment_status: string | null
          external_id: string
          grade: string | null
          id: string
          is_deleted: boolean
          is_local: boolean
          name: string
          parent_phone: string | null
          phone: string | null
          school: string | null
          synced_at: string
          temp_password: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          branch?: string | null
          class_time?: string | null
          cohort?: string | null
          created_at?: string
          enrollment_status?: string | null
          external_id: string
          grade?: string | null
          id?: string
          is_deleted?: boolean
          is_local?: boolean
          name: string
          parent_phone?: string | null
          phone?: string | null
          school?: string | null
          synced_at?: string
          temp_password?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          branch?: string | null
          class_time?: string | null
          cohort?: string | null
          created_at?: string
          enrollment_status?: string | null
          external_id?: string
          grade?: string | null
          id?: string
          is_deleted?: boolean
          is_local?: boolean
          name?: string
          parent_phone?: string | null
          phone?: string | null
          school?: string | null
          synced_at?: string
          temp_password?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instructors: {
        Row: {
          all_branches: boolean
          auth_user_id: string | null
          branch: string | null
          cohort: string | null
          cohorts: string[]
          created_at: string
          department_id: number | null
          email: string | null
          external_id: string | null
          hire_date: string | null
          id: string
          is_active: boolean
          is_team_leader: boolean
          must_change_password: boolean
          name: string
          phone: string | null
          team_id: number | null
          updated_at: string
        }
        Insert: {
          all_branches?: boolean
          auth_user_id?: string | null
          branch?: string | null
          cohort?: string | null
          cohorts?: string[]
          created_at?: string
          department_id?: number | null
          email?: string | null
          external_id?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          is_team_leader?: boolean
          must_change_password?: boolean
          name: string
          phone?: string | null
          team_id?: number | null
          updated_at?: string
        }
        Update: {
          all_branches?: boolean
          auth_user_id?: string | null
          branch?: string | null
          cohort?: string | null
          cohorts?: string[]
          created_at?: string
          department_id?: number | null
          email?: string | null
          external_id?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          is_team_leader?: boolean
          must_change_password?: boolean
          name?: string
          phone?: string | null
          team_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      notices: {
        Row: {
          body: string
          branch: string | null
          card_body: string | null
          cards: Json
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          display_type: string[]
          id: string
          is_pinned: boolean
          is_published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          branch?: string | null
          card_body?: string | null
          cards?: Json
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          display_type?: string[]
          id?: string
          is_pinned?: boolean
          is_published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          branch?: string | null
          card_body?: string | null
          cards?: Json
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          display_type?: string[]
          id?: string
          is_pinned?: boolean
          is_published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          batch_id: string
          branch: string | null
          channel: string
          class_id: string
          created_at: string
          error_message: string | null
          hidden_at: string | null
          id: string
          message: string
          phone: string
          recipient_name: string
          sent_by: string
          success: boolean
          user_id: string | null
        }
        Insert: {
          batch_id: string
          branch?: string | null
          channel: string
          class_id: string
          created_at?: string
          error_message?: string | null
          hidden_at?: string | null
          id?: string
          message: string
          phone: string
          recipient_name?: string
          sent_by: string
          success?: boolean
          user_id?: string | null
        }
        Update: {
          batch_id?: string
          branch?: string | null
          channel?: string
          class_id?: string
          created_at?: string
          error_message?: string | null
          hidden_at?: string | null
          id?: string
          message?: string
          phone?: string
          recipient_name?: string
          sent_by?: string
          success?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      student_temp_password_history: {
        Row: {
          auth_user_id: string
          created_at: string
          external_student_id: string | null
          id: string
          issued_by: string | null
          temp_password: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          external_student_id?: string | null
          id?: string
          issued_by?: string | null
          temp_password: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          external_student_id?: string | null
          id?: string
          issued_by?: string | null
          temp_password?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          sent_by: string
          subject: string
          team_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          sent_by: string
          subject: string
          team_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          sent_by?: string
          subject?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      video_progress: {
        Row: {
          completed_at: string | null
          current_seconds: number
          duration: number | null
          is_completed: boolean
          max_seconds: number
          seek_attempts: number
          updated_at: string
          user_id: string
          video_id: string
          watched_ratio: number
          watched_seconds: number
        }
        Insert: {
          completed_at?: string | null
          current_seconds?: number
          duration?: number | null
          is_completed?: boolean
          max_seconds?: number
          seek_attempts?: number
          updated_at?: string
          user_id: string
          video_id: string
          watched_ratio?: number
          watched_seconds?: number
        }
        Update: {
          completed_at?: string | null
          current_seconds?: number
          duration?: number | null
          is_completed?: boolean
          max_seconds?: number
          seek_attempts?: number
          updated_at?: string
          user_id?: string
          video_id?: string
          watched_ratio?: number
          watched_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "video_progress_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_seek_events: {
        Row: {
          blocked: boolean
          created_at: string
          from_seconds: number
          id: string
          to_seconds: number
          user_id: string
          video_id: string
        }
        Insert: {
          blocked?: boolean
          created_at?: string
          from_seconds?: number
          id?: string
          to_seconds?: number
          user_id: string
          video_id: string
        }
        Update: {
          blocked?: boolean
          created_at?: string
          from_seconds?: number
          id?: string
          to_seconds?: number
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_seek_events_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_student_exclusions: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_student_exclusions_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "videos"
            referencedColumns: ["id"]
          },
        ]
      }
      videos: {
        Row: {
          allow_seek: boolean
          class_id: string | null
          completion_ratio: number
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          duration: number | null
          external_url: string | null
          external_video_id: string | null
          file_size_bytes: number | null
          folder_id: string | null
          id: string
          is_published: boolean
          max_playback_rate: number
          player_embed_url: string | null
          rewatch_allow_seek: boolean | null
          rewatch_max_playback_rate: number | null
          sort_order: number
          source: string
          status: string
          thumbnail_url: string | null
          title: string
          updated_at: string
          upload_duration_ms: number | null
          upload_retry_count: number | null
          upload_stalled_ms: number | null
          upload_started_at: string | null
          vimeo_uri: string | null
          vimeo_video_id: string | null
          week_label: string | null
        }
        Insert: {
          allow_seek?: boolean
          class_id?: string | null
          completion_ratio?: number
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          duration?: number | null
          external_url?: string | null
          external_video_id?: string | null
          file_size_bytes?: number | null
          folder_id?: string | null
          id?: string
          is_published?: boolean
          max_playback_rate?: number
          player_embed_url?: string | null
          rewatch_allow_seek?: boolean | null
          rewatch_max_playback_rate?: number | null
          sort_order?: number
          source?: string
          status?: string
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          upload_duration_ms?: number | null
          upload_retry_count?: number | null
          upload_stalled_ms?: number | null
          upload_started_at?: string | null
          vimeo_uri?: string | null
          vimeo_video_id?: string | null
          week_label?: string | null
        }
        Update: {
          allow_seek?: boolean
          class_id?: string | null
          completion_ratio?: number
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          duration?: number | null
          external_url?: string | null
          external_video_id?: string | null
          file_size_bytes?: number | null
          folder_id?: string | null
          id?: string
          is_published?: boolean
          max_playback_rate?: number
          player_embed_url?: string | null
          rewatch_allow_seek?: boolean | null
          rewatch_max_playback_rate?: number | null
          sort_order?: number
          source?: string
          status?: string
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          upload_duration_ms?: number | null
          upload_retry_count?: number | null
          upload_stalled_ms?: number | null
          upload_started_at?: string | null
          vimeo_uri?: string | null
          vimeo_video_id?: string | null
          week_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "videos_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "class_folders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      branch_admin_branch: { Args: { _uid: string }; Returns: string }
      can_access_video: {
        Args: { _user_id: string; _video_id: string }
        Returns: boolean
      }
      class_sms_recent_batches: {
        Args: { _class_id: string; _limit?: number }
        Returns: {
          batch_id: string
          last_at: string
        }[]
      }
      class_stats_agg: {
        Args: { _class_ids: string[] }
        Returns: {
          class_id: string
          completed_cells: number
          student_count: number
          sum_ratio: number
          total_cells: number
          video_count: number
        }[]
      }
      class_student_stats_agg: {
        Args: { _class_id: string }
        Returns: {
          completed: number
          enrolled_at: string
          last_activity: string
          sum_ratio: number
          user_id: string
          video_total: number
        }[]
      }
      class_student_stats_agg_range: {
        Args: { _class_id: string; _from?: string; _to?: string }
        Returns: {
          completed: number
          enrolled_at: string
          last_activity: string
          sum_ratio: number
          user_id: string
          video_total: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      instructor_can_access_class: {
        Args: { _class_id: string; _uid: string }
        Returns: boolean
      }
      is_video_class_instructor: {
        Args: { _user_id: string; _video_id: string }
        Returns: boolean
      }
      overview_stats_agg: {
        Args: { _class_ids: string[] }
        Returns: {
          completed_count: number
          student_count: number
          sum_ratio: number
          total_views: number
          video_count: number
        }[]
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "student"
        | "pending"
        | "instructor"
        | "branch_admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "user",
        "student",
        "pending",
        "instructor",
        "branch_admin",
      ],
    },
  },
} as const
