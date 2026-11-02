import { createClient } from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined; const key=import.meta.env.VITE_SUPABASE_ANON_KEY as string|undefined;
export const isSupabaseConfigured=Boolean(url&&key); export const supabase=isSupabaseConfigured?createClient(url!,key!,{auth:{persistSession:true,autoRefreshToken:true}}):null;
export type StoryPage={id:string;image_url:string;text:string;text_position:'top'|'center'|'bottom';overlay:boolean;font_size:'small'|'medium'|'large';text_color:'light'|'dark';sort_order:number};
export type Story={id:string;title:string;age_range:string;category:string;summary:string;lesson:string;reading_minutes:number;cover_url:string;is_free:boolean;status:'draft'|'published';pages:StoryPage[];questions?:string[]};