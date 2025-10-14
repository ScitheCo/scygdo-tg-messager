import { Zap, LogOut, Plus } from "lucide-react";
import { Button } from "./ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { useState } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Header = () => {
  const { signOut, user } = useAuth();
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut();
      toast.success("Çıkış yapıldı");
    } catch (error) {
      toast.error("Çıkış sırasında bir hata oluştu");
    }
  };

  const handleSaveApiCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from("telegram_api_credentials").insert({
        api_id: apiId,
        api_hash: apiHash,
        created_by: user?.id,
      });

      if (error) throw error;

      toast.success("API bilgileri kaydedildi");
      setApiDialogOpen(false);
      setApiId("");
      setApiHash("");
    } catch (error: any) {
      toast.error("API bilgileri kaydedilemedi: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <header className="bg-card border-b border-border px-4 md:px-6 py-3 md:py-4 sticky top-0 z-50 backdrop-blur-sm bg-card/95">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-primary to-secondary rounded-lg">
            <Zap className="w-4 h-4 md:w-6 md:h-6 text-white" />
          </div>
          <div>
            <h1 className="text-base md:text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Scygdo Telegram
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">{user?.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Dialog open={apiDialogOpen} onOpenChange={setApiDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 md:gap-2 text-xs md:text-sm">
                <Plus className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">API Ayarları</span>
                <span className="sm:hidden">API</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[90vw] sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Telegram API Bilgileri</DialogTitle>
                <DialogDescription>
                  Telegram hesapları eklemek için API ID ve Hash gereklidir.
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline ml-1"
                  >
                    my.telegram.org/apps
                  </a>{" "}
                  adresinden alabilirsiniz.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSaveApiCredentials} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="api_id">API ID</Label>
                  <Input
                    id="api_id"
                    placeholder="12345678"
                    value={apiId}
                    onChange={(e) => setApiId(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api_hash">API Hash</Label>
                  <Input
                    id="api_hash"
                    placeholder="abcdef1234567890abcdef1234567890"
                    value={apiHash}
                    onChange={(e) => setApiHash(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1 md:gap-2 text-xs md:text-sm">
            <LogOut className="h-3 w-3 md:h-4 md:w-4" />
            <span className="hidden sm:inline">Çıkış</span>
          </Button>
        </div>
      </div>
    </header>
  );
};
