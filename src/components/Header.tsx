import { Zap } from 'lucide-react';

export const Header = () => {
  return (
    <header className="bg-card border-b border-border px-6 py-4 sticky top-0 z-50 backdrop-blur-sm bg-card/95">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg">
          <Zap className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            Scithe Telegram Paneli
          </h1>
          <p className="text-xs text-muted-foreground">Çoklu hesap yönetim sistemi</p>
        </div>
      </div>
    </header>
  );
};
