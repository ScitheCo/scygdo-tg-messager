import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './ui/input-otp';
import { Plus, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';

interface AddAccountDialogProps {
  onAccountAdded: () => void;
}

export const AddAccountDialog = ({ onAccountAdded }: AddAccountDialogProps) => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedApiId, setSelectedApiId] = useState('');
  const [otp, setOtp] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [accountId, setAccountId] = useState('');
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

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedApiId) {
      toast.error('Lütfen bir API kimlik bilgisi seçin');
      return;
    }

    setLoading(true);

    try {
      // Get API credentials
      const { data: apiCred, error: apiError } = await supabase
        .from('telegram_api_credentials')
        .select('*')
        .eq('id', selectedApiId)
        .single();

      if (apiError || !apiCred) throw new Error('API bilgileri alınamadı');

      // First, insert the account as inactive
      const { data: accountData, error: insertError } = await supabase
        .from('telegram_accounts')
        .insert({
          phone_number: phoneNumber,
          api_credential_id: selectedApiId,
          is_active: false,
          created_by: user?.id
        })
        .select()
        .single();

      if (insertError) throw insertError;
      setAccountId(accountData.id);

      // Create Telegram client and send code directly from frontend
      const client = new TelegramClient(
        new StringSession(''),
        parseInt(apiCred.api_id),
        apiCred.api_hash,
        {
          connectionRetries: 5,
        }
      );

      await client.connect();

      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phoneNumber,
          apiId: parseInt(apiCred.api_id),
          apiHash: apiCred.api_hash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: false,
          }),
        })
      );

      await client.disconnect();

      // Access phoneCodeHash from the result
      const phoneCodeHashValue = 'phoneCodeHash' in result ? (result as any).phoneCodeHash : '';
      if (!phoneCodeHashValue) {
        throw new Error('phoneCodeHash alınamadı');
      }
      
      setPhoneCodeHash(phoneCodeHashValue);
      setStep('otp');
      toast.success('Doğrulama kodu Telegram\'a gönderildi');
    } catch (error: any) {
      console.error('Error sending code:', error);
      if (error.code === '23505') {
        toast.error('Bu telefon numarası zaten kayıtlı');
      } else {
        toast.error('Kod gönderilemedi: ' + (error.message || 'Bilinmeyen hata'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (otp.length !== 5) {
      toast.error('Lütfen 5 haneli kodu girin');
      return;
    }

    setLoading(true);

    try {
      // Get API credentials again
      const { data: apiCred, error: apiError } = await supabase
        .from('telegram_api_credentials')
        .select('*')
        .eq('id', selectedApiId)
        .single();

      if (apiError || !apiCred) throw new Error('API bilgileri alınamadı');

      // Create Telegram client and verify code directly from frontend
      const client = new TelegramClient(
        new StringSession(''),
        parseInt(apiCred.api_id),
        apiCred.api_hash,
        {
          connectionRetries: 5,
        }
      );

      await client.connect();

      const authResult = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phoneNumber,
          phoneCodeHash: phoneCodeHash,
          phoneCode: otp,
        })
      );

      // Get session string
      const sessionString = client.session.save() as unknown as string;

      await client.disconnect();

      // Update account with session string and activate it
      const { error: updateError } = await supabase
        .from('telegram_accounts')
        .update({
          session_string: sessionString,
          is_active: true
        })
        .eq('id', accountId);

      if (updateError) throw updateError;

      toast.success('Hesap başarıyla aktif edildi');
      setOpen(false);
      resetForm();
      onAccountAdded();
    } catch (error: any) {
      console.error('Error verifying code:', error);
      toast.error('Kod doğrulanamadı: ' + (error.message || 'Bilinmeyen hata'));
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setStep('phone');
    setPhoneNumber('');
    setSelectedApiId('');
    setOtp('');
    setPhoneCodeHash('');
    setAccountId('');
  };

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen);
      if (!newOpen) resetForm();
    }}>
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
            {step === 'phone' 
              ? 'Telefon numaranızı girin ve doğrulama kodu alın.'
              : 'Telegram\'a gelen 5 haneli doğrulama kodunu girin.'}
          </DialogDescription>
        </DialogHeader>
        
        {step === 'phone' ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
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
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Kod Gönderiliyor...
                </>
              ) : (
                'Doğrulama Kodu Gönder'
              )}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Doğrulama Kodu</Label>
              <div className="flex justify-center">
                <InputOTP maxLength={5} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Telegram'dan gelen 5 haneli kodu girin
              </p>
            </div>

            <div className="flex gap-2">
              <Button 
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setStep('phone')}
                disabled={loading}
              >
                Geri
              </Button>
              <Button 
                type="submit" 
                className="flex-1" 
                disabled={loading || otp.length !== 5}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Doğrulanıyor...
                  </>
                ) : (
                  'Hesabı Aktif Et'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
