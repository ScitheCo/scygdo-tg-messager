import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, AlertCircle, RotateCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AuthorizedUser {
  id: string;
  telegram_username: string;
  created_at: string;
}

interface EmojiTask {
  id: string;
  queue_number: number;
  telegram_username: string;
  group_link: string;
  post_link: string;
  task_type: string;
  requested_count: number;
  available_count: number;
  status: string;
  total_success: number;
  total_failed: number;
  created_at: string;
}

interface TaskLog {
  id: string;
  task_id: string;
  account_id: string;
  action_type: string;
  emoji_used: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  telegram_accounts: {
    name: string | null;
    phone_number: string;
  };
}

interface WorkerStatus {
  worker_id: string;
  last_seen: string;
  status: string;
  version: string | null;
  machine_info: any;
}

export default function EmojiPanel() {
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [tasks, setTasks] = useState<EmojiTask[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [stats, setStats] = useState({
    total: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchAuthorizedUsers();
    fetchTasks();
    fetchLogs();
    fetchWorkerStatus();
    subscribeToChanges();
  }, []);

  useEffect(() => {
    // Calculate stats
    const total = tasks.length;
    const queued = tasks.filter(t => t.status === 'queued').length;
    const processing = tasks.filter(t => t.status === 'processing').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    setStats({ total, queued, processing, completed, failed });
  }, [tasks]);

  const subscribeToChanges = () => {
    const tasksChannel = supabase
      .channel('emoji-tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emoji_tasks' }, () => {
        fetchTasks();
      })
      .subscribe();

    const logsChannel = supabase
      .channel('emoji-logs-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emoji_task_logs' }, () => {
        fetchLogs();
      })
      .subscribe();

    const heartbeatChannel = supabase
      .channel('worker-heartbeat-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'worker_heartbeats'
      }, () => {
        fetchWorkerStatus();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(tasksChannel);
      supabase.removeChannel(logsChannel);
      supabase.removeChannel(heartbeatChannel);
    };
  };

  const fetchAuthorizedUsers = async () => {
    const { data, error } = await supabase
      .from('authorized_bot_users')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: "Hata", description: "Yetkili kullanıcılar yüklenemedi", variant: "destructive" });
      return;
    }
    setAuthorizedUsers(data || []);
  };

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from('emoji_tasks')
      .select('*')
      .order('queue_number', { ascending: false })
      .limit(50);

    if (error) {
      toast({ title: "Hata", description: "Görevler yüklenemedi", variant: "destructive" });
      return;
    }
    setTasks(data || []);
  };

  const fetchLogs = async () => {
    const { data, error } = await supabase
      .from('emoji_task_logs')
      .select(`
        *,
        telegram_accounts (name, phone_number)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      toast({ title: "Hata", description: "Loglar yüklenemedi", variant: "destructive" });
      return;
    }
    setLogs(data || []);
  };

  const fetchWorkerStatus = async () => {
    const { data, error } = await supabase
      .from('worker_heartbeats')
      .select('*')
      .eq('worker_id', 'telegram-inviter')
      .gte('last_seen', new Date(Date.now() - 60000).toISOString())
      .single();

    if (error) {
      console.error('Worker status fetch error:', error);
      setWorkerStatus(null);
      return;
    }

    setWorkerStatus(data);
  };

  const handleAddUser = async () => {
    const username = newUsername.replace('@', '').trim();
    if (!username) {
      toast({ title: "Hata", description: "Kullanıcı adı boş olamaz", variant: "destructive" });
      return;
    }

    const { error } = await supabase
      .from('authorized_bot_users')
      .insert({ telegram_username: username });

    if (error) {
      toast({ title: "Hata", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Başarılı", description: `@${username} eklendi` });
    setNewUsername("");
    fetchAuthorizedUsers();
  };

  const handleRemoveUser = async (id: string) => {
    const { error } = await supabase
      .from('authorized_bot_users')
      .delete()
      .eq('id', id);

    if (error) {
      toast({ title: "Hata", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: "Başarılı", description: "Kullanıcı kaldırıldı" });
    fetchAuthorizedUsers();
  };

  const handleClearAllTasks = async () => {
    if (!confirm('Tüm görevler silinecek. Emin misiniz?')) return;
    
    try {
      const { error } = await supabase
        .from('emoji_tasks')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (error) {
        toast({ 
          title: "Hata", 
          description: "Görevler silinemedi: " + error.message, 
          variant: "destructive" 
        });
        return;
      }

      toast({ 
        title: "Başarılı", 
        description: "Tüm görevler silindi" 
      });

      fetchTasks();
    } catch (error) {
      toast({ 
        title: "Hata", 
        description: "Görevler silinemedi", 
        variant: "destructive" 
      });
    }
  };

  const handleRetryTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('emoji_tasks')
        .update({ 
          status: 'queued',
          started_at: null,
          completed_at: null,
          assigned_worker_id: null,
          error_message: null,
          processing_mode: 'desktop_worker',
        })
        .eq('id', taskId);

      if (error) {
        toast({ 
          title: "Hata", 
          description: "Görev sıfırlanamadı: " + error.message, 
          variant: "destructive" 
        });
        return;
      }

      toast({ 
        title: "Başarılı", 
        description: "Görev tekrar sıraya alındı" 
      });
    } catch (error) {
      toast({ 
        title: "Hata", 
        description: "Görev sıfırlanamadı", 
        variant: "destructive" 
      });
    }
  };

  const getTaskTypeBadge = (type: string) => {
    const types: Record<string, string> = {
      positive_emoji: '📈 Pozitif',
      negative_emoji: '📉 Negatif',
      view_only: '👁️ Görüntüleme',
      custom_emoji: '🎨 Özel',
    };
    return types[type] || type;
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case 'completed':
        return 'default';
      case 'queued':
        return 'secondary';
      case 'failed':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const truncate = (str: string, maxLen = 30) => {
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString('tr-TR');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 space-y-6">
        {/* Worker Status */}
        <Card className={workerStatus?.status === 'online' ? 'border-green-500' : 'border-destructive'}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>☁️ Railway Worker Durumu</span>
              {workerStatus?.status === 'online' ? (
                <Badge variant="default" className="bg-green-500 text-white">
                  🟢 Online
                </Badge>
              ) : (
                <Badge variant="destructive">
                  🔴 Offline
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workerStatus ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                  <div>
                    <div className="font-medium">telegram-inviter</div>
                    <div className="text-xs text-muted-foreground">
                      Railway Cloud · {workerStatus.version || 'v1.0'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={workerStatus.status === 'online' ? 'text-green-500 font-medium' : 'text-destructive font-medium'}>
                      {workerStatus.status}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Son: {formatDate(workerStatus.last_seen)}
                    </div>
                  </div>
                </div>
                {stats.queued > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      ⏳ Sırada {stats.queued} görev var, otomatik işlenecek
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Worker çevrimdışı. Railway deployment kontrol edin.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Görev</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Sırada Bekleyen</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-500">{stats.queued}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">İşleniyor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-500">{stats.processing}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tamamlanan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-500">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Başarısız</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-500">{stats.failed}</div>
            </CardContent>
          </Card>
        </div>

        {/* Authorized Users */}
        <Card>
          <CardHeader>
            <CardTitle>🔐 Yetkili Kullanıcılar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="@kullaniciadi"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddUser()}
              />
              <Button onClick={handleAddUser}>
                <Plus className="mr-2 h-4 w-4" />
                Ekle
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kullanıcı Adı</TableHead>
                  <TableHead>Eklenme Tarihi</TableHead>
                  <TableHead className="text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authorizedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>@{user.telegram_username}</TableCell>
                    <TableCell>{formatDate(user.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemoveUser(user.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {authorizedUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      Henüz yetkili kullanıcı eklenmemiş
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Task List */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>📋 Görev Listesi</CardTitle>
            {tasks.length > 0 && (
              <Button 
                variant="destructive" 
                size="sm"
                onClick={handleClearAllTasks}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Tümünü Sil
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sıra</TableHead>
                    <TableHead>Kullanıcı</TableHead>
                    <TableHead>Grup</TableHead>
                    <TableHead>Post</TableHead>
                    <TableHead>Tip</TableHead>
                    <TableHead>Hesap</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Başarı/Hata</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>#{task.queue_number}</TableCell>
                      <TableCell>@{task.telegram_username}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{truncate(task.group_link)}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{truncate(task.post_link)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getTaskTypeBadge(task.task_type)}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {task.total_success + task.total_failed}/{task.requested_count}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({Math.round(((task.total_success + task.total_failed) / task.requested_count) * 100)}%)
                            </span>
                          </div>
                          <div className="w-32 bg-muted rounded-full h-2.5 overflow-hidden">
                            <div className="flex h-full">
                              <div 
                                className="bg-green-500 transition-all duration-300"
                                style={{ width: `${(task.total_success / task.requested_count) * 100}%` }}
                                title={`Başarılı: ${task.total_success}`}
                              />
                              <div 
                                className="bg-red-500 transition-all duration-300"
                                style={{ width: `${(task.total_failed / task.requested_count) * 100}%` }}
                                title={`Başarısız: ${task.total_failed}`}
                              />
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(task.status)} className="min-w-[80px] justify-center">
                          {task.status === 'queued' && '⏳ Sırada'}
                          {task.status === 'processing' && '🔄 İşleniyor'}
                          {task.status === 'completed' && '✅ Tamamlandı'}
                          {task.status === 'failed' && '❌ Başarısız'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-green-500 font-medium">✓ {task.total_success}</span>
                            <span className="text-red-500 font-medium">✗ {task.total_failed}</span>
                          </div>
                          {task.requested_count > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {Math.round(((task.total_success + task.total_failed) / task.requested_count) * 100)}% işlendi
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(task.created_at)}</TableCell>
                      <TableCell className="text-right">
                        {(task.status === 'processing' || task.status === 'failed') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRetryTask(task.id)}
                          >
                            <RotateCw className="h-4 w-4 mr-2" />
                            Tekrar Dene
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {tasks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground">
                        Henüz görev bulunmuyor
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Logs */}
        <Card>
          <CardHeader>
            <CardTitle>📝 İşlem Logları</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Görev ID</TableHead>
                    <TableHead>Hesap</TableHead>
                    <TableHead>İşlem</TableHead>
                    <TableHead>Emoji</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Hata</TableHead>
                    <TableHead>Tarih</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">{log.task_id.slice(0, 8)}...</TableCell>
                      <TableCell>
                        {log.telegram_accounts?.name || log.telegram_accounts?.phone_number || 'N/A'}
                      </TableCell>
                      <TableCell>{log.action_type}</TableCell>
                      <TableCell>{log.emoji_used || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={log.status === 'success' ? 'default' : 'destructive'}>
                          {log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {log.error_message || '-'}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(log.created_at)}</TableCell>
                    </TableRow>
                  ))}
                  {logs.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Henüz log bulunmuyor
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
