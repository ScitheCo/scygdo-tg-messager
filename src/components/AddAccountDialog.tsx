import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';

interface AddAccountDialogProps {
  onAccountAdded: () => void;
}

export const AddAccountDialog = ({ onAccountAdded }: AddAccountDialogProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedApiId, setSelectedApiId] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: apiCredentials } = useQuery({
    queryKey: ['telegram-api-credentials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_api_credentials')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedApiId) {
      toast.error('Lütfen bir API kimlik bilgisi seçin');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.from('telegram_accounts').insert({
        phone_number: phoneNumber,
        api_credential_id: selectedApiId,
        is_active: false,
        created_by: user?.id
      });

      if (error) throw error;

      toast.success('Telegram hesabı eklendi');
      toast.info('Hesap aktivasyonu için telegram-auth edge fonksiyonunu kullanın');
      setOpen(false);
      setPhoneNumber('');
      setSelectedApiId('');
      onAccountAdded();
    } catch (error: any) {
      if (error.code === '23505') {
        toast.error('Bu telefon numarası zaten kayıtlı');
      } else {
        toast.error('Hesap eklenemedi: ' + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Hesap Ekle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Telegram Hesabı Ekle</DialogTitle>
          <DialogDescription>
            Yeni bir Telegram hesabı ekleyin. Telefon numarasını uluslararası formatta (+90...) girin.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefon Numarası</Label>
            <Input
              id="phone"
              placeholder="+905551234567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="api_credential">API Kimlik Bilgisi</Label>
            <Select value={selectedApiId} onValueChange={setSelectedApiId} required>
              <SelectTrigger id="api_credential">
                <SelectValue placeholder="Seçiniz..." />
              </SelectTrigger>
              <SelectContent>
                {apiCredentials?.map((cred) => (
                  <SelectItem key={cred.id} value={cred.id}>
                    API ID: {cred.api_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(!apiCredentials || apiCredentials.length === 0) && (
              <p className="text-xs text-muted-foreground">
                Önce Header'daki "API Ayarları" butonundan API bilgilerinizi ekleyin.
              </p>
            )}
          </div>

          <Button 
            type="submit" 
            className="w-full" 
            disabled={loading || !selectedApiId}
          >
            {loading ? 'Ekleniyor...' : 'Hesap Ekle'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};
