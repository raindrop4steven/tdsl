import { Hero } from './Landing/Hero';
import { Build } from './Landing/Build';
import { GetStarted } from './Landing/GetStarted';
import { Features } from './Landing/Features';
import { Footer } from './Landing/Footer';

export default function App() {
  return (
    <div className="site">
      <Hero />
      <GetStarted />
      <Build />
      <Features />
      <Footer />
    </div>
  );
}
