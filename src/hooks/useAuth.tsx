import { useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Fetch user role when session changes
        if (session?.user) {
          setTimeout(() => {
            fetchUserRole(session.user.id);
          }, 0);
        } else {
          setUserRole(null);
          setUserRoles([]);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      if (session?.user) {
        fetchUserRole(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    try {
      console.log('Fetching roles for user:', userId);
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      
      console.log('Roles data:', data, 'Error:', error);
      
      if (!error && Array.isArray(data)) {
        const roles = data.map((d: any) => String(d.role));
        setUserRoles(roles);
        setUserRole(roles[0] ?? null);
        console.log('User roles set to:', roles);
      } else {
        console.log('No roles found or error occurred');
      }
    } catch (error) {
      console.error('Error fetching user roles:', error);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUserRole(null);
    setUserRoles([]);
  };

  const isSuperAdmin = userRoles.some((r) => {
    const n = r.toLowerCase().replace(/[\s-]+/g, '_');
    return n.includes('super') && n.includes('admin');
  });

  return { user, session, loading, signOut, userRole, userRoles, isSuperAdmin };
};
