import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Play, Pause, StopCircle, ArrowRight, Download, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/Header";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";

const MemberScraping = () => {
  const { user } = useAuth();
  const [stage, setStage] = useState<'configure' | 'fetch' | 'process'>('configure');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [scannerAccountId, setScannerAccountId] = useState("");
  const [selectedInviterIds, setSelectedInviterIds] = useState<string[]>([]);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [inviteDelay, setInviteDelay] = useState(60);
  const [batchDelay, setBatchDelay] = useState(180);
  const [filterBots, setFilterBots] = useState(true);
  const [filterAdmins, setFilterAdmins] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showMyAccountsOnly, setShowMyAccountsOnly] = useState(false);
  const [sourceValidation, setSourceValidation] = useState<{ valid: boolean; title?: string; error?: string } | null>(null);
  const [targetValidation, setTargetValidation] = useState<{ valid: boolean; title?: string; error?: string } | null>(null);
  const [isValidatingSource, setIsValidatingSource] = useState(false);
  const [isValidatingTarget, setIsValidatingTarget] = useState(false);
  const [useExistingSession, setUseExistingSession] = useState(false);
  const [selectedExistingSessionId, setSelectedExistingSessionId] = useState("");
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const { data: allAccounts } = useQuery({
    queryKey: ["telegram-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("telegram_accounts").select("*").eq("is_active", true).order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const accounts = showMyAccountsOnly 
    ? allAccounts?.filter(acc => acc.created_by === user?.id)
    : allAccounts;
  
  // Önceki session'ları listele
  const { data: previousSessions } = useQuery({
    queryKey: ["previous-sessions"],
    queryFn: async () => {
      // Önce sadece session'ları çek
      const { data, error } = await supabase
        .from("scraping_sessions")
        .select("id, source_group_title, target_group_title, created_at, status, total_in_queue, total_processed")
        .eq("created_by", user?.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      
      // Her session için denenmemiş üye sayısını hesapla
      const sessionsWithQueuedCount = await Promise.all(
        (data || []).map(async (session) => {
          const { count } = await supabase
            .from("scraped_members")
            .select("*", { count: "exact", head: true })
            .eq("session_id", session.id)
            .eq("status", "queued");
          
          return {
            ...session,
            queued_count: count || 0
          };
        })
      );
      
      // Sadece devam ettirilebilecek session'ları filtrele (en az 1 queued üyesi olanlar)
      return sessionsWithQueuedCount.filter(s => s.queued_count > 0);
    },
    enabled: !!user?.id,
  });
  
  const { data: session, refetch: refetchSession } = useQuery({
    queryKey: ["scraping-session", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      const { data, error } = await supabase.from("scraping_sessions").select("*").eq("id", sessionId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
    refetchInterval: 3000,
  });
  
  const { data: members, refetch: refetchMembers } = useQuery({
    queryKey: ["scraped-members", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase.from("scraped_members").select("*").eq("session_id", sessionId).order("sequence_number");
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && stage !== 'configure',
  });
  
  const { data: sessionAccounts, refetch: refetchSessionAccounts } = useQuery({
    queryKey: ["session-accounts", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const { data, error } = await supabase.from("session_accounts").select("*, telegram_accounts(name, phone_number)").eq("session_id", sessionId);
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId && stage === 'process',
  });
  
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase.channel(`session:${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scraping_sessions', filter: `id=eq.${sessionId}` }, () => refetchSession())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'scraped_members', filter: `session_id=eq.${sessionId}` }, () => refetchMembers())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_accounts', filter: `session_id=eq.${sessionId}` }, () => refetchSessionAccounts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId]);
  
  const handleCreateSession = async () => {
    // Önceki session seçildiyse
    if (useExistingSession && selectedExistingSessionId) {
      if (!targetInput || selectedInviterIds.length === 0) {
        toast.error("Lütfen hedef grup ve davet hesaplarını seçin");
        return;
      }
      
      try {
        // Session'u güncelle
        await supabase
          .from("scraping_sessions")
          .update({
            target_group_input: targetInput,
            settings: { 
              daily_limit: dailyLimit, 
              invite_delay: inviteDelay, 
              batch_delay: batchDelay, 
              filter_bots: filterBots, 
              filter_admins: filterAdmins 
            },
            updated_at: new Date().toISOString()
          })
          .eq("id", selectedExistingSessionId);
        
        // Mevcut session_accounts'ları sil
        await supabase
          .from("session_accounts")
          .delete()
          .eq("session_id", selectedExistingSessionId);
        
        // Yeni hesapları ekle
        const accountInserts = selectedInviterIds.map(accountId => ({ 
          session_id: selectedExistingSessionId, 
          account_id: accountId 
        }));
        await supabase.from("session_accounts").insert(accountInserts);
        
        setSessionId(selectedExistingSessionId);
        setStage('process');
        toast.success("Session güncellendi, devam ediyoruz!");
      } catch (error: any) {
        toast.error("Session güncellenirken hata: " + error.message);
      }
      return;
    }
    
    // Yeni session oluştur
    if (!sourceInput || !targetInput || !scannerAccountId || selectedInviterIds.length === 0) {
      toast.error("Lütfen tüm alanları doldurun");
      return;
    }
    try {
      const { data: newSession, error: sessionError } = await supabase.from("scraping_sessions").insert({
        created_by: user?.id, source_group_input: sourceInput, target_group_input: targetInput,
        settings: { daily_limit: dailyLimit, invite_delay: inviteDelay, batch_delay: batchDelay, filter_bots: filterBots, filter_admins: filterAdmins },
        status: 'configuring'
      }).select().single();
      if (sessionError) throw sessionError;
      const accountInserts = selectedInviterIds.map(accountId => ({ session_id: newSession.id, account_id: accountId }));
      const { error: accountsError } = await supabase.from("session_accounts").insert(accountInserts);
      if (accountsError) throw accountsError;
      setSessionId(newSession.id);
      setStage('fetch');
      toast.success("Oturum oluşturuldu");
    } catch (error: any) {
      toast.error(error.message);
    }
  };
  
  const handleFetchMembers = async () => {
    if (!sessionId || !scannerAccountId) return;
    
    setIsFetching(true);
    
    // Session'u fetching_members durumuna al
    await supabase
      .from('scraping_sessions')
      .update({ status: 'fetching_members', updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    
    const loadingToast = toast.loading('Tarayıcınızdan Telegram\'a bağlanılıyor...');

    try {
      // Scanner hesabı bilgilerini al
      const { data: account, error: accountError } = await supabase
        .from('telegram_accounts')
        .select('*, telegram_api_credentials(*)')
        .eq('id', scannerAccountId)
        .single();

      if (accountError || !account) {
        throw new Error('Scanner hesabı bulunamadı');
      }

      toast.loading('Telegram client başlatılıyor...', { id: loadingToast });

      // Telegram client'ı başlat
      const stringSession = new StringSession(account.session_string || '');
      const client = new TelegramClient(
        stringSession,
        parseInt(account.telegram_api_credentials.api_id),
        account.telegram_api_credentials.api_hash,
        { 
          connectionRetries: 5,
          useWSS: true
        }
      );

      // Bağlan
      await client.connect();
      toast.loading('Telegram\'a bağlandı, kaynak grup çözümleniyor...', { id: loadingToast });

      // Kaynak grubu çözümle
      let sourceEntity;
      try {
        if (sourceInput.startsWith('@') || !sourceInput.match(/^\-?\d+$/)) {
          sourceEntity = await client.getEntity(sourceInput);
        } else {
          sourceEntity = await client.getEntity(parseInt(sourceInput));
        }
      } catch (error) {
        throw new Error('Kaynak grup bulunamadı. Grup ID veya kullanıcı adını kontrol edin.');
      }

      const sourceEntityAny = sourceEntity as any;
      console.log('Kaynak grup:', sourceEntityAny.title);

      // Session'a kaynak grup bilgisini kaydet
      await supabase
        .from('scraping_sessions')
        .update({
          source_group_id: sourceEntityAny.id?.toString(),
          source_group_title: sourceEntityAny.title
        })
        .eq('id', sessionId);

      toast.loading(`${sourceEntityAny.title} grubundan üyeler çekiliyor...`, { id: loadingToast });

      // Üyeleri çek
      let allParticipants: any[] = [];
      let offset = 0;
      const limit = 100;
      let hasMore = true;
      let fetchedCount = 0;

      while (hasMore) {
        try {
          const result: any = await client.invoke(
            new Api.channels.GetParticipants({
              channel: sourceEntity,
              filter: new Api.ChannelParticipantsSearch({ q: '' }),
              offset: offset,
              limit: limit,
              hash: 0 as any,
            })
          );

          if (result.users.length === 0) {
            hasMore = false;
          } else {
            const batch = result.users.map((user: any, idx: number) => {
              const participant = result.participants?.[idx];
              return {
                user,
                participant,
                isAdmin: participant?.className === 'ChannelParticipantAdmin' || 
                        participant?.className === 'ChannelParticipantCreator'
              };
            });
            
            allParticipants = allParticipants.concat(batch);
            offset += result.users.length;
            fetchedCount = offset;
            
            toast.loading(`${fetchedCount} üye çekildi...`, { id: loadingToast });
            
            // Progress güncelle
            await supabase
              .from('scraping_sessions')
              .update({ total_members_fetched: fetchedCount })
              .eq('id', sessionId);

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        } catch (error: any) {
          console.error('Batch çekme hatası:', error);
          hasMore = false;
        }
      }

      await client.disconnect();

      toast.loading('Üyeler filtreleniyor ve kaydediliyor...', { id: loadingToast });

      // Filtreleme ve kaydetme - TOPLU INSERT İLE OPTİMİZE EDİLDİ
      let sequenceNumber = 1;
      let filteredCount = 0;
      const membersToInsert: any[] = [];

      for (const item of allParticipants) {
        const user = item.user;
        
        // Filtreleme
        if (filterBots && user.bot) {
          filteredCount++;
          continue;
        }
        
        if (filterAdmins && item.isAdmin) {
          filteredCount++;
          continue;
        }

        // Array'e ekle (sadece gerekli alanlar)
        membersToInsert.push({
          session_id: sessionId,
          sequence_number: sequenceNumber++,
          user_id: user.id?.toString(),
          access_hash: user.accessHash?.toString() || null,
          is_bot: user.bot || false,
          is_admin: item.isAdmin,
          status: 'queued'
        });
      }

      // Toplu insert - 1000'erli parçalar halinde
      const chunkSize = 1000;
      let queuedCount = 0;
      
      for (let i = 0; i < membersToInsert.length; i += chunkSize) {
        const chunk = membersToInsert.slice(i, i + chunkSize);
        const { error: insertError } = await supabase
          .from('scraped_members')
          .insert(chunk);
        
        if (!insertError) {
          queuedCount += chunk.length;
        }
        
        // Progress güncelle (her 1000 üyede bir)
        if (i % chunkSize === 0 && i > 0) {
          toast.loading(`${queuedCount} üye kaydedildi...`, { id: loadingToast });
        }
      }

      // Final güncelleme
      await supabase
        .from('scraping_sessions')
        .update({
          status: 'ready',
          total_members_fetched: allParticipants.length,
          total_filtered_out: filteredCount,
          total_in_queue: queuedCount,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId);

      toast.success(`${queuedCount} üye başarıyla çekildi! (${filteredCount} filtrelendi)`, { id: loadingToast });
      setStage('process');
      
    } catch (error: any) {
      console.error('Fetch error:', error);
      toast.error('Hata: ' + (error.message || 'Bilinmeyen hata'), { id: loadingToast });
      
      await supabase
        .from('scraping_sessions')
        .update({ 
          status: 'error',
          error_message: error.message || 'Üye çekme sırasında hata oluştu'
        })
        .eq('id', sessionId);
    } finally {
      setIsFetching(false);
    }
  };
  
  const handleStart = async () => {
    if (!sessionId) return;
    await supabase.from('scraping_sessions').update({ status: 'running' }).eq('id', sessionId);
    setIsProcessing(true);
    startPolling();
  };
  
  const handlePause = async () => {
    if (!sessionId) return;
    await supabase.from('scraping_sessions').update({ status: 'paused' }).eq('id', sessionId);
    stopPolling();
    setIsProcessing(false);
  };
  
  const handleResume = async () => {
    if (!sessionId) return;
    await refetchSessionAccounts();
    await supabase.from('scraping_sessions').update({ status: 'running' }).eq('id', sessionId);
    setIsProcessing(true);
    startPolling();
  };
  
  const handleCancel = async () => {
    if (!sessionId) return;
    await supabase.from('scraping_sessions').update({ status: 'cancelled' }).eq('id', sessionId);
    stopPolling();
    setIsProcessing(false);
    toast.success("İşlem iptal edildi");
  };
  
  const startPolling = () => {
    if (pollingIntervalRef.current) return;
    
    pollingIntervalRef.current = setInterval(async () => {
      if (!sessionId) return;
      
      try {
        const { data, error } = await supabase.functions.invoke('process-member-invites', {
          body: {
            session_id: sessionId,
            batch_size: 10
          }
        });
        
        if (error) throw error;
        
        if (data?.session_status === 'paused') {
          toast.warning("Tüm hesapların günlük limiti doldu");
          stopPolling();
          setIsProcessing(false);
        }
        
        if (data?.session_status === 'completed') {
          toast.success("Tüm üyeler işlendi!");
          stopPolling();
          setIsProcessing(false);
        }
      } catch (error: any) {
        console.error('Polling error:', error);
      }
    }, 5000);
  };
  
  const stopPolling = () => {
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
  };
  
  useEffect(() => { return () => stopPolling(); }, []);

  const handleValidateGroup = async (groupInput: string, isSource: boolean) => {
    const setBusy = (v: boolean) => (isSource ? setIsValidatingSource(v) : setIsValidatingTarget(v));
    const setResult = (res: { valid: boolean; title?: string; error?: string }) =>
      isSource ? setSourceValidation(res) : setTargetValidation(res);

    if (!groupInput || !scannerAccountId) {
      toast.error("Lütfen grup bilgisini girin ve tarayıcı hesap seçin");
      return;
    }

    // Lightweight format validation (username / ID / t.me link)
    const input = groupInput.trim();
    const isNumericId = /^-?\d{5,20}$/.test(input);
    const usernameMatch = input.match(/(?:^@|t\.me\/)([A-Za-z0-9_]{5,32})/i);

    setBusy(true);
    try {
      // 10 sn timeout ile edge function'a dene, sonra format bazlı sonuca düş
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const { data, error } = await supabase.functions.invoke('validate-telegram-group', {
          body: { group_input: input, account_id: scannerAccountId },
          signal: controller.signal as any,
        });
        clearTimeout(timeout);
        if (error) throw error;

        if (data?.valid) {
          setResult({ valid: true, title: data.title || (isNumericId ? 'Grup ID' : usernameMatch ? '@' + usernameMatch[1] : 'Geçerli') });
          toast.success(`${data.title || 'Grup'} doğrulandı`);
          return;
        }
        // data.valid değilse format fallback
        throw new Error(data?.error || 'Doğrulanamadı');
      } catch (err: any) {
        // Timeout/abort veya servis hatası durumunda format bazlı güvenli fallback
        if (isNumericId) {
          setResult({ valid: true, title: 'ID formatı geçerli (Telegram doğrulaması zaman aşımı)' });
          toast.message('ID formatı geçerli', { description: 'Gerçek doğrulama üyeleri çek adımında yapılacak.' });
        } else if (usernameMatch) {
          setResult({ valid: true, title: `@${usernameMatch[1]} formatı geçerli (doğrulama bekleniyor)` });
          toast.message('Format geçerli', { description: 'Gerçek doğrulama üyeleri çek adımında yapılacak.' });
        } else {
          setResult({ valid: false, error: 'Geçersiz format. @kullaniciadi, -100... ID veya t.me linki girin.' });
          toast.error('Geçersiz grup formatı');
        }
      }
    } finally {
      setBusy(false);
    }
  };
  
  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      queued: { variant: "secondary", text: "Sırada" },
      processing: { variant: "default", text: "İşleniyor" },
      success: { variant: "default", text: "Başarılı", className: "bg-green-500" },
      failed: { variant: "destructive", text: "Başarısız" },
      skipped: { variant: "outline", text: "Atlandı" }
    };
    const config = variants[status] || variants.queued;
    return <Badge variant={config.variant} className={config.className}>{config.text}</Badge>;
  };
  
  const progressPercent = session ? (session.total_processed / session.total_in_queue) * 100 : 0;
  
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Üye Ekleme Sistemi V2</h1>
        </div>
      
        {stage === 'configure' && (
          <Card><CardHeader><CardTitle>1. Yapılandırma</CardTitle></CardHeader><CardContent className="space-y-4">
            
            {/* Yeni veya Önceki Session Seçimi */}
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    checked={!useExistingSession} 
                    onCheckedChange={() => setUseExistingSession(false)}
                  />
                  <Label>Yeni Session Oluştur</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    checked={useExistingSession} 
                    onCheckedChange={() => setUseExistingSession(true)}
                  />
                  <Label>Önceki Session'u Devam Ettir</Label>
                </div>
              </div>

              {useExistingSession && (
                <div className="space-y-2">
                  <Label>Önceki Session'larım</Label>
                  {previousSessions && previousSessions.length > 0 ? (
                    <Select 
                      value={selectedExistingSessionId} 
                      onValueChange={async (value) => {
                        setSelectedExistingSessionId(value);
                        
                        // Seçilen session'ın bilgilerini yükle
                        const { data: sess } = await supabase
                          .from("scraping_sessions")
                          .select("*, session_accounts(account_id)")
                          .eq("id", value)
                          .single();
                        
                        if (sess) {
                          // Kaynak ve hedef grupları form'a yükle
                          setSourceInput(sess.source_group_input);
                          setTargetInput(sess.target_group_input);
                          
                          // Ayarları yükle
                          const settings = sess.settings as any;
                          setDailyLimit(settings?.daily_limit || 50);
                          setInviteDelay(settings?.invite_delay || 60);
                          setBatchDelay(settings?.batch_delay || 180);
                          setFilterBots(settings?.filter_bots ?? true);
                          setFilterAdmins(settings?.filter_admins ?? true);
                          
                          // Mevcut hesapları seç
                          const accountIds = sess.session_accounts?.map((sa: any) => sa.account_id) || [];
                          setSelectedInviterIds(accountIds);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Session seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {previousSessions.map((sess: any) => (
                          <SelectItem key={sess.id} value={sess.id}>
                            <div className="flex flex-col">
                              <div className="font-medium">
                                {sess.source_group_title || 'Kaynak'} → {sess.target_group_title || 'Hedef'}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                📅 {new Date(sess.created_at).toLocaleDateString('tr-TR')} | 
                                👥 {sess.total_in_queue} toplam | 
                                ⏳ {sess.queued_count} bekliyor |
                                ✅ {sess.total_processed} işlendi
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">Devam ettirilebilecek session bulunamadı</p>
                  )}
                </div>
              )}
            </div>

            {/* Yeni session VEYA önceki session seçildiyse ayarları göster */}
            {(!useExistingSession || selectedExistingSessionId) && (
              <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Kaynak Grup (Üyeleri çekilecek grup)</Label>
                <div className="flex gap-2">
                  <Input 
                    value={sourceInput} 
                    onChange={(e) => {
                      setSourceInput(e.target.value);
                      setSourceValidation(null);
                    }} 
                    placeholder="@grupadi, -1001234567890 veya link" 
                  />
                  <Button 
                    onClick={() => handleValidateGroup(sourceInput, true)} 
                    disabled={isValidatingSource || !scannerAccountId}
                    variant="outline"
                    size="icon"
                  >
                    {isValidatingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  </Button>
                </div>
                {sourceValidation && (
                  <div className={`flex items-center gap-2 mt-2 text-sm ${sourceValidation.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {sourceValidation.valid ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <span>{sourceValidation.valid ? sourceValidation.title : sourceValidation.error}</span>
                  </div>
                )}
              </div>
              <div>
                <Label>Hedef Grup (Üyelerin ekleneceği grup)</Label>
                <div className="flex gap-2">
                  <Input 
                    value={targetInput} 
                    onChange={(e) => {
                      setTargetInput(e.target.value);
                      setTargetValidation(null);
                    }} 
                    placeholder="@grupadi, -1001234567890 veya link" 
                  />
                  <Button 
                    onClick={() => handleValidateGroup(targetInput, false)} 
                    disabled={isValidatingTarget || !scannerAccountId}
                    variant="outline"
                    size="icon"
                  >
                    {isValidatingTarget ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  </Button>
                </div>
                {targetValidation && (
                  <div className={`flex items-center gap-2 mt-2 text-sm ${targetValidation.valid ? 'text-green-600' : 'text-red-600'}`}>
                    {targetValidation.valid ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    <span>{targetValidation.valid ? targetValidation.title : targetValidation.error}</span>
                  </div>
                )}
              </div>
            </div>
          <div><Label>Tarayıcı Hesap</Label>
            <Select value={scannerAccountId} onValueChange={setScannerAccountId}>
              <SelectTrigger><SelectValue placeholder="Hesap seçin" /></SelectTrigger>
              <SelectContent>{accounts?.map((acc) => <SelectItem key={acc.id} value={acc.id}>{acc.name || acc.phone_number}</SelectItem>)}</SelectContent>
            </Select>
          </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Davet Hesapları</Label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="my-accounts-only" className="text-sm text-muted-foreground">Sadece benim hesaplarım</Label>
                  <Switch 
                    id="my-accounts-only"
                    checked={showMyAccountsOnly} 
                    onCheckedChange={setShowMyAccountsOnly}
                  />
                </div>
              </div>
              <div className="border rounded-lg p-4 space-y-2 max-h-48 overflow-auto">
                {accounts && accounts.length > 0 ? (
                  accounts.map((acc) => (
                    <div key={acc.id} className="flex items-center space-x-2">
                      <Checkbox checked={selectedInviterIds.includes(acc.id)} onCheckedChange={(checked) => {
                        if (checked) setSelectedInviterIds([...selectedInviterIds, acc.id]);
                        else setSelectedInviterIds(selectedInviterIds.filter(id => id !== acc.id));
                      }} />
                      <label className="text-sm">{acc.name || acc.phone_number}</label>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {showMyAccountsOnly ? "Henüz hesap eklemediniz" : "Hiç hesap yok"}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Günlük Limit (hesap başına)</Label>
                <Input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground mt-1">Her hesabın günde ekleyebileceği maksimum üye sayısı</p>
              </div>
              <div>
                <Label>Her davet arasında bekleme (saniye)</Label>
                <Input type="number" value={inviteDelay} onChange={(e) => setInviteDelay(parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground mt-1">Her üye daveti arasında beklenecek süre</p>
              </div>
              <div>
                <Label>Her 10 davetten sonra bekleme (saniye)</Label>
                <Input type="number" value={batchDelay} onChange={(e) => setBatchDelay(parseInt(e.target.value))} />
                <p className="text-xs text-muted-foreground mt-1">10 üye ekledikten sonra beklenecek ek süre</p>
              </div>
            </div>
            <div className="space-y-3">
              <Label>Filtreler</Label>
              <div className="flex gap-4">
                <div className="flex items-center space-x-2"><Checkbox checked={filterBots} onCheckedChange={(c) => setFilterBots(c as boolean)} /><Label>Botları çıkar</Label></div>
                <div className="flex items-center space-x-2"><Checkbox checked={filterAdmins} onCheckedChange={(c) => setFilterAdmins(c as boolean)} /><Label>Adminleri çıkar</Label></div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex gap-2">
                <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-blue-900 dark:text-blue-100">Flood Wait Hatası Hakkında</p>
                  <p className="text-blue-800 dark:text-blue-200">
                    Telegram'dan "flood wait" hatası alındığında (çok fazla istek), hesap otomatik olarak belirtilen süre boyunca bekletilir. 
                    Bu süre dolana kadar hesap kullanılmaz ve diğer hesaplarla işleme devam edilir.
                  </p>
                </div>
              </div>
            </div>

            <Button 
              onClick={handleCreateSession} 
              className="w-full" 
              size="lg"
              disabled={useExistingSession && !selectedExistingSessionId}
            >
              {useExistingSession ? 'Session\'u Güncelle ve Devam Et' : 'Oturumu Oluştur'} <ArrowRight className="ml-2" />
            </Button>
              </>
            )}
          </CardContent></Card>
        )}
      
      {stage === 'fetch' && (
        <Card><CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>2. Üyeleri Çek</CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                setStage('configure');
                setSessionId(null);
                setSourceValidation(null);
                setTargetValidation(null);
              }}
            >
              ← Geri
            </Button>
          </div>
        </CardHeader><CardContent className="space-y-4">
          {session && <div className="space-y-3">
            <p><strong>Kaynak:</strong> {session.source_group_input}</p>
            <p><strong>Hedef:</strong> {session.target_group_input}</p>
            
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-900 dark:text-blue-100">
                    Tek tıkla üyeleri çek
                  </p>
                  <p className="text-blue-800 dark:text-blue-200">
                    Ek kurulum yok. Aşağıdaki butonla işlemi tarayıcı üzerinden başlatın.
                  </p>
                </div>
              </div>
            </div>

            <Button onClick={handleFetchMembers} disabled={isFetching} className="w-full" size="lg">
              {isFetching ? 'Çekiliyor...' : 'Üyeleri Çek'}
            </Button>
            {(session.status === 'fetching' || session.status === 'fetching_members') && session.total_members_fetched >= 0 && (
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />
                  <div>
                    <p className="font-semibold text-blue-900 dark:text-blue-100">
                      Üyeler çekiliyor...
                    </p>
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      {session.total_members_fetched} üye çekildi
                    </p>
                  </div>
                </div>
              </div>
            )}

            {session.status === 'ready' && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-semibold text-green-900 dark:text-green-100">
                      Üyeler başarıyla çekildi!
                    </p>
                    <p className="text-sm text-green-800 dark:text-green-200">
                      {session.total_in_queue} üye kuyruğa eklendi, {session.total_filtered_out} üye filtrelendi
                    </p>
                  </div>
                </div>
              </div>
            )}

            {session.status === 'error' && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                  <div>
                    <p className="font-semibold text-red-900 dark:text-red-100">Hata oluştu</p>
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {(session as any).error_message || 'Lütfen edge function loglarını kontrol edin'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>}

          {session?.status === 'ready' && (
            <Button onClick={() => setStage('process')} className="w-full" size="lg">
              İleri: Üye Ekleme <ArrowRight className="ml-2" />
            </Button>
          )}
        </CardContent></Card>
      )}
      
      {stage === 'process' && session && (
        <Card><CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>3. Üye Ekleme İşlemi</CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                if (confirm('İşlemi iptal edip başa dönmek istiyor musunuz?')) {
                  handleCancel();
                  setTimeout(() => {
                    setStage('configure');
                    setSessionId(null);
                    setSourceValidation(null);
                    setTargetValidation(null);
                  }, 500);
                }
              }}
            >
              ← Başa Dön
            </Button>
          </div>
        </CardHeader><CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span>İşlenen: {session.total_processed} / {session.total_in_queue}</span><span>{progressPercent.toFixed(1)}%</span></div>
            <Progress value={progressPercent} />
            <div className="flex justify-between text-sm"><span className="text-green-600">Başarılı: {session.total_success}</span><span className="text-red-600">Başarısız: {session.total_failed}</span></div>
          </div>
          <div className="flex gap-2">
            {session.status === 'ready' && <Button onClick={handleStart} className="flex-1"><Play className="mr-2" /> Başlat</Button>}
            {session.status === 'running' && <Button onClick={handlePause} variant="secondary" className="flex-1"><Pause className="mr-2" /> Duraklat</Button>}
            {session.status === 'paused' && <Button onClick={handleResume} className="flex-1"><Play className="mr-2" /> Devam Et</Button>}
            <Button onClick={handleCancel} variant="destructive" className="flex-1"><StopCircle className="mr-2" /> İptal</Button>
          </div>
          {sessionAccounts && sessionAccounts.length > 0 && (
            <div className="border rounded-lg p-4"><h4 className="font-semibold mb-2">Hesap Durumları</h4>
              <div className="space-y-1">{sessionAccounts.map((acc: any) => (
                <div key={acc.id} className="flex justify-between text-sm">
                  <span>{acc.telegram_accounts?.name || acc.telegram_accounts?.phone_number}</span>
                  <span>{acc.is_active ? <Badge className="bg-green-500">Aktif ({acc.added_today}/{dailyLimit})</Badge> : <Badge variant="secondary">Limit Doldu</Badge>}</span>
                </div>
              ))}</div>
            </div>
          )}
          <div className="border rounded-lg"><div className="p-4 border-b"><h4 className="font-semibold">Üye Listesi</h4></div>
            <ScrollArea className="h-[400px]">
              <Table><TableHeader><TableRow><TableHead className="w-20">Sıra</TableHead><TableHead>Üye ID</TableHead><TableHead>Kullanıcı Adı</TableHead><TableHead className="w-32">Durum</TableHead></TableRow></TableHeader>
                <TableBody>{members?.map((member: any) => (
                  <TableRow key={member.id}><TableCell>{member.sequence_number}</TableCell><TableCell className="font-mono text-xs">{member.user_id}</TableCell><TableCell>{member.username ? `@${member.username}` : '-'}</TableCell><TableCell>{getStatusBadge(member.status)}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            </ScrollArea>
          </div>
        </CardContent></Card>
        )}
      </div>
    </div>
  );
};

export default MemberScraping;
