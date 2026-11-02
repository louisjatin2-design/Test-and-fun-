// Regeldaten in eigenen Worten (deutsche Kurzfassungen) für Assistenten und Regelwerk.
// Vollständige Originaltexte: Wahapedia bzw. eure Battlepack-Bücher.

// ---------- Pfade ----------
// who: 'hero' | 'nonhero' | 'any'; req: Zusatzbedingung (Schlüsselwort)
const A = (name, when, fx) => ({ name, when, fx });
export const PATHS = [
  // ===== Ravaged Coast (in Blighted Wilds ebenfalls erlaubt) =====
  { id: 'brawler', name: 'Path of the Brawler', de: 'Pfad des Raufbolds', src: 'rc', who: 'hero', req: '', ranks: [
    [A('Dependable Assault', 'Deine Angriffsphase', 'Nicht im Nahkampf und weder gerannt noch zurückgezogen: 7" bewegen, auch durch feindliche Kontrollbereiche; muss ½" an einem sichtbaren Feind enden und gilt dann als angegriffen.'), A('First to the Fight', 'Passiv', '+2 auf Angriffswürfe.')],
    [A("Veteran's Eye", 'Passiv', '+1 auf Trefferwürfe im Nahkampf.'), A('Powerful Bruiser', 'Passiv', '+1 auf Verwundungswürfe im Nahkampf.')],
    [A('Reckless Brutality', 'Jede Nahkampfphase', 'Für die Phase: −1 auf eigene Rettungswürfe, +2 Durchschlag für alle Waffen.'), A('Deathdealer', 'Ende jedes Zuges', 'Für jeden Feind im Nahkampf mit ihm W3 werfen; ab 2+ so viele tödliche Schadenspunkte.')],
    [A('Devastating Strength', 'Aufstellungsphase', 'Eine Nahkampfwaffe erhält für die Schlacht +1 Schaden.'), A('Flurry of Attacks', 'Passiv', '+2 Attacken für alle Nahkampfwaffen.')],
  ] },
  { id: 'ruler', name: 'Path of the Ruler', de: 'Pfad des Herrschers', src: 'rc', who: 'hero', req: '', ranks: [
    [A('Lead by Example', 'Jede Angriffsphase', 'Hat er angegriffen: eine andere befreundete Einheit vollständig in 12" darf Angriffswürfe für die Phase wiederholen.'), A('Inspirational', 'Jede Heldenphase', 'Befreundete Nicht-Helden-Einheit vollständig in 12": 2W6 auf ihren Kontrollwert bis Zugende.')],
    [A('Stand Firm', 'Jede Nahkampfphase', 'Er und eine Nicht-Helden-Einheit in Kontrollbereich: nutzt einer „All-out Defence“, darf der andere sie kostenlos ebenfalls nutzen.'), A('Magnificent Fury', 'Passiv', 'Solange er im Nahkampf ist: +1 Verwunden für Nahkampfattacken anderer Befreundeter in seinem Kontrollbereich.')],
    [A('Drillmaster', 'Jede Nahkampfphase', 'Im Nahkampf: eine Nahkampfwaffe einer anderen Einheit in Kontrollbereich +1 Durchschlag bis Zugende.'), A('Martial Exemplar', 'Ende jedes Zuges', 'Hat er in diesem Zug eine Einheit vernichtet: eine sichtbare befreundete Einheit vollständig in 12" erhält bis Ende der nächsten Schlachtrunde +1 Attacke im Nahkampf.')],
    [A("'To Arms!'", '1× pro Zug (Armee), deine Heldenphase', 'Im Nahkampf: eine andere befreundete Einheit im Nahkampf vollständig in 12" darf sofort kämpfen, als wäre Nahkampfphase.'), A('Decisive Strike', 'Gegnerische Nahkampfphase', 'Nicht im Nahkampf: jede befreundete Einheit in seinem Kontrollbereich, die nicht im Nahkampf ist, darf W6" ziehen – auch in den Nahkampf.')],
  ] },
  { id: 'duellist', name: 'Path of the Duellist', de: 'Pfad des Duellanten', src: 'rc', who: 'hero', req: 'INFANTERIE', ranks: [
    [A('Deflection', 'Passiv', 'Waffenfähigkeiten, die bei kritischen Treffern wirken, haben gegen ihn keine Wirkung.'), A('Take the Lead', 'Passiv', 'Im Nahkampf mit einer Einheit mit STRIKE-FIRST hat er ebenfalls STRIKE-FIRST.')],
    [A('Deadly Riposte', 'Reaktion: Gegner kämpft gegen ihn', 'Hat er noch nicht gekämpft: jede unmodifizierte 1 beim Treffen gegen ihn verursacht tödlichen Schaden = Schadenswert der Waffe; dafür −1 auf seine eigenen Trefferwürfe.'), A('Precise Thrust', 'Passiv', 'Feinde im Nahkampf mit ihm dürfen keine Schutzwürfe (Ward) machen.')],
    [A('Deadly Riposte', 'Reaktion: Gegner kämpft gegen ihn', 'Hat er noch nicht gekämpft: auf 4+ sofort selbst kämpfen, alle Attacken gegen diese Einheit.'), A('Precise Thrust', 'Passiv', 'Kritische Treffer im Nahkampf schon auf unmodifizierte 5+.')],
    [A('Apotheosis of Steel', 'Passiv', 'Jede Nahkampfattacke gegen ihn, die nicht trifft: 1 tödlicher Schaden beim Angreifer.'), A('To Surpass All', 'Passiv', 'Nach seiner ersten vernichteten Einheit: Ward 6+ für die Schlacht, +1 auf Ward für jede weitere (max. +2).')],
  ] },
  { id: 'warmonger', name: 'Path of the Warmonger', de: 'Pfad des Kriegstreibers', src: 'rc', who: 'hero', req: 'INFANTERIE', ranks: [
    [A('Lost in the Melee', 'Passiv', 'Kann im Nahkampf nicht beschossen werden.'), A('Caked in Gore', 'Passiv', '+10 Kontrollwert im Nahkampf.')],
    [A('Quick Fire', 'Jede Schussphase', 'Im Nahkampf: eine Fernkampfwaffe erhält auf 3+ „Shoot in Combat“, muss aber den gewählten Gegner beschießen.'), A('Gifted Gladiator', 'Reaktion: All-out Attack/Defence', 'Im Nahkampf: auf 3+ kostet der Befehl keinen Befehlspunkt.')],
    [A('Blindsiding Barrage', 'Passiv', 'Hat er diese Runde angegriffen: STRIKE-FIRST bis Rundenende.'), A('Bringer of Carnage', 'Jede Nahkampfphase', 'Eine Nahkampfwaffe: W6 – bei 1–4 +1 Schaden, bei 5+ +2 Schaden für die Phase.')],
    [A('To Fight Eternal', 'Ende jedes Zuges', 'Hat er gekämpft: +1 Attacke für Nahkampfwaffen (ohne Companion) für den Rest der Schlacht.'), A('Slice and Dice', 'Jede Nahkampfphase', 'Für jeden Feind im Nahkampf mit ihm einen Würfel: je 2+ +1 Durchschlag für die Phase.')],
  ] },
  { id: 'sorcerer', name: 'Path of the Sorcerer', de: 'Pfad des Hexers', src: 'rc', who: 'hero', req: 'ZAUBERER', ranks: [
    [A('Focused Sorcery', 'Passiv', 'Erster Nicht-Beschwörungszauber pro Phase: +2 auf den Zauberwurf.'), A('Power Disruptor', 'Passiv', '+1 auf Bannwürfe; darf Zauber überall auf dem Feld bannen statt nur in 30".')],
    [A('Overspilling Power', 'Ende deines Zuges', 'Darf einen Zauber wirken, als wäre Heldenphase.'), A('Honed Talent', 'Passiv', 'Pasch beim Zauberwurf: +1 Machtstufe für den Rest der Phase.')],
    [A('Arcane Onslaught', 'Passiv', 'UNLIMITED-Zauber dürfen bis zu 2 Ziele haben.'), A('Arcane Avalanche', '1× pro Zug, deine Heldenphase', 'Sein nächster Zauber in dieser Phase kann nicht gebannt werden.')],
    [A('Arcane Onslaught', 'Ende deines Zuges', 'Hat einer seiner Zauber diesen Zug eine Einheit vernichtet: +1 Machtstufe für die Schlacht.'), A('Arcane Avalanche', 'Reaktion: Gegner kämpft gegen ihn', 'Bis Ende des nächsten Zuges: −1 Treffen/Verwunden, −1 Durchschlag und Schaden gegen ihn, −1 eigene Machtstufe.')],
  ] },
  { id: 'conjurer', name: 'Path of the Conjurer', de: 'Pfad des Beschwörers', src: 'rc', who: 'hero', req: 'ZAUBERER', ranks: [
    [A('Ancient Technique', '1× pro Zug, Reaktion: Beschwörungszauber', '+1 auf den Zauberwurf.'), A('Master Banisher', 'Passiv', '+2 auf Bannungswürfe gegen Manifestationen.')],
    [A('Expert Summoner', 'Passiv', 'Manifestationen dürfen 3" weiter entfernt aufgestellt werden.'), A('Total Banishment', '1× pro Schlacht (Armee), Ende der Runde', 'Alle gegnerischen Manifestationen werden gebannt.')],
    [A('Disrupting Presence', 'Passiv', 'Feindliche Beschwörungszauber in 12": −2 auf den Zauberwurf.'), A('Castigator', 'Deine Bewegungsphase', 'Feindliche Manifestation in 6": Bannwurf 2W6; gelingt er, W3 tödlicher Schaden beim Beschwörer und Manifestation gebannt.')],
    [A('Silence the Aether', 'Passiv', 'Feinde in 12" können keine Beschwörungszauber wirken.'), A('Supreme Conjurer', '1× pro Schlacht (Armee), Reaktion: Beschwörung', 'Zauberwurf zählt als 8 (unveränderlich); Manifestation vollständig in 6" und sichtbar aufstellen.')],
  ] },
  { id: 'zealot', name: 'Path of the Zealot', de: 'Pfad des Eiferers', src: 'rc', who: 'hero', req: 'PRIESTER', ranks: [
    [A('Paragon of Faith', 'Aufstellungsphase', 'Erhält W3 Ritualpunkte.'), A('Scourging Castigation', 'Deine Bewegungsphase', 'Feindlicher Priester in 12": W3 Ritualpunkte abziehen (min. 1 bleibt).')],
    [A('Firebrand Exhortations', 'Deine Heldenphase', '+1 auf Gebetswürfe.'), A('Refute the False', 'Passiv', 'Feinde in 12": −1 auf Gebetswürfe.')],
    [A('Smite False Prophets', 'Passiv', 'Gebetswurf 12+: 1 tödlicher Schaden bei jedem feindlichen Priester und Zauberer.'), A('Assured Devotion', 'Passiv', 'Würfelt ein feindlicher Priester eine natürliche 1 beim Gebet: er erhält W3 Ritualpunkte.')],
    [A('Resurrecting Touch', 'Deine Heldenphase (Gebet, Wert 7)', 'Vernichteter befreundeter Infanterie-Held: Ersatzeinheit vollständig in 3" aufstellen.'), A('Grand Armageddon', '1× pro Schlacht, deine Schussphase', 'Für jedes Missionsziel W6: so viel tödlicher Schaden bei jeder Einheit, die es umkämpft.')],
  ] },
  { id: 'invoker', name: 'Path of the Invoker', de: 'Pfad des Anrufers', src: 'rc', who: 'hero', req: 'PRIESTER', ranks: [
    [A('Heard by the Divine', '1× pro Zug, Reaktion: Beschwörungsgebet', '+1 auf den Gebetswurf.'), A('Sacred Aura', 'Passiv', 'Jedes erhörte Gebet: Heilen (1) bei jeder befreundeten Einheit in 3".')],
    [A('Test Their Faith', 'Passiv', 'Bannt er eine Manifestation: W6 tödlicher Schaden beim Beschwörer.'), A('Incandescent Faith', 'Passiv', 'Seine Manifestationen dürfen 6" weiter entfernt aufgestellt werden.')],
    [A('Restore the Faithful', '1× pro Schlacht, Ende jedes Zuges', 'Heilen (W6) bei jeder befreundeten Einheit.'), A('Resolute Conviction', 'Ende jedes Zuges', 'Manifestation in Kontrollbereich: auf 3+ gebannt.')],
    [A('Sparking Divinity', 'Passiv', 'Jedes erhörte Beschwörungsgebet: +1 Machtstufe für die Schlacht.'), A('Dominant Dogma', '1× pro Zug, Reaktion: Beschwörungsgebet', 'Ritualpunkte fallen danach nur auf die Hälfte des Gebetswerts statt auf 0.')],
  ] },
  { id: 'colossus', name: 'Path of the Colossus', de: 'Pfad des Kolosses', src: 'rc', who: 'hero', req: 'MONSTER', ranks: [
    [A('Alpha Beast', 'Passiv', 'Feindliche Monster im Nahkampf mit ihm: −2 Kontrollwert.'), A('Thundering Bulk', 'Passiv', '„Power Through“ verursacht 1 zusätzlichen tödlichen Schaden.')],
    [A('Bestial Bellows', 'Passiv', 'Champion-, Standarten- und Musiker-Fähigkeiten wirken bei Feinden in 12" nicht.'), A('Wrestle Down', 'Passiv', 'Kann nicht Ziel feindlicher RAMPAGE-Fähigkeiten sein.')],
    [A('Volcanic Charge', '1× pro Schlacht, jede Angriffsphase', 'Nicht im Nahkampf, nicht gerannt: 9" bewegen, durch Kontrollbereiche, Ende ½" an Feind, gilt als Angriff.'), A('Animal Fury', 'Passiv', '+1 Attacke für alle Waffen, auch Companion.')],
    [A('Pulverising Blows', 'Jede Nahkampfphase (Rampage)', 'Sichtbarer Feind im Nahkampf: auf 3+ −1 auf dessen Rettungswürfe für die Phase.'), A('Obliterating Impact', 'Jede Nahkampfphase (Rampage)', 'Nach Angriff: Würfel = Lebenspunkte minus erlittener Schaden; je 4+ 1 tödlicher Schaden beim Feind in 1".')],
  ] },
  { id: 'dragoon', name: 'Path of the Dragoon', de: 'Pfad des Dragoners', src: 'rc', who: 'hero', req: 'KAVALLERIE', ranks: [
    [A('Fleet Steed', 'Passiv', '+2" bei jeder Bewegung.'), A('Deft Assault', 'Gegnerische Nahkampfphase', 'Nicht im Nahkampf: bis 3" bewegen, auch in den Nahkampf.')],
    [A('Saddlemaster', 'Passiv', 'Darf schießen, obwohl er gerannt ist.'), A('Ashplain Runner', 'Passiv', '+1 auf Angriffswürfe.')],
    [A('Follow-up Strike', '1× pro Schlacht, jede Nahkampfphase', 'Hat er diesen Zug nicht angegriffen: +1 Schaden für Nahkampfwaffen bis Zugende.'), A("From Doom's Jaws", 'Passiv', 'Kein tödlicher Schaden durch Rückzug.')],
    [A('Daring Deathblow', 'Passiv', 'Durch Nahkampf vernichtet: 12 Würfel, je 5+ 1 tödlicher Schaden beim Angreifer.'), A('Shock and Awe', 'Jede Nahkampfphase', 'Nach Angriff: sofort schießen (nur auf den Gegner im Nahkampf), Fernkampfwaffen haben „Shoot in Combat“.')],
  ] },
  { id: 'guardian', name: 'Path of the Guardian', de: 'Pfad des Wächters', src: 'rc', who: 'nonhero', req: '', ranks: [
    [A('Beck and Call', 'Reaktion: All-out Attack eines Infanterie-Helden in Kontrollbereich', '+1 auf Trefferwürfe für die Phase.'), A('Hidden in the Ranks', 'Passiv', 'Fernkampf gegen befreundete Nicht-Monster-Helden in ihrem Kontrollbereich: −1 Verwunden.')],
    [A('Cut-throat Fighters', 'Gegnerische Nahkampfphase', 'Nicht angegriffen: je Modell in 3" des Ziels ein Würfel, jede 6 = 1 tödlicher Schaden.'), A('Bold and Stalwart', 'Passiv', '+5 Kontrollwert, solange ein Nicht-Monster-Held in Kontrollbereich ist.')],
    [A('Fortified Defences', 'Passiv', 'Nicht bewegt und kein Nachrücken: +1 auf Rettungswürfe.'), A('Devoted Lifewards', 'Passiv', 'Befreundete Infanterie-Helden vollständig in Kontrollbereich: Ward 5+.')],
    [A('Cast Them Back', 'Passiv', 'Feindliche Infanterie im Nahkampf mit ihnen kann keine Missionsziele umkämpfen.'), A('Strike as One', '1× pro Schlacht, jede Nahkampfphase', 'Sie und ein Nicht-Monster-Held in Kontrollbereich: STRIKE-FIRST bis Zugende.')],
  ] },
  { id: 'bulwark', name: 'Path of the Bulwark', de: 'Pfad des Bollwerks', src: 'rc', who: 'nonhero', req: 'INFANTERIE', ranks: [
    [A('Indomitable Defenders', 'Passiv', 'Umkämpfen alle Modelle ein Ziel außerhalb feindlichen Gebiets: +5 Kontrollwert.'), A('Anti-cavalry Tactics', 'Passiv', 'Ziel vollständig im eigenen Gebiet: Nahkampfwaffen erhalten Anti-Charge (+1 Durchschlag).')],
    [A('Thin the Ranks', '1× pro Schlacht, jede Nahkampfphase', 'Nicht angegriffen: Würfel; ist er kleiner als die Modellzahl des Gegners, so viel tödlicher Schaden.'), A('Defence Above All', 'Jede Nahkampfphase', 'Vollständig im eigenen Gebiet: auf 4+ +1 Rettung, aber STRIKE-LAST bis Zugende.')],
    [A('Fortress Formation', 'Passiv', 'Auf eigenem Ziel: Feinde mit niedrigerem Lebenswert im Nahkampf mit ihnen können keine Ziele umkämpfen.'), A('Territorial', 'Passiv', 'Auf Ziel im eigenen Gebiet: Feinde dürfen nicht in 12" aufgestellt werden.')],
    [A('Fight Fire with Fire', 'Passiv', 'Nutzt ein Feind im Nahkampf mit ihnen „All-out Attack“: +1 Rettung bis Zugende.'), A('Made of Stone', 'Passiv', 'Auf Ziel im eigenen Gebiet: „Charge (+1 Damage)“ wirkt gegen sie nicht.')],
  ] },
  { id: 'cavalier', name: 'Path of the Cavalier', de: 'Pfad des Reiters', src: 'rc', who: 'nonhero', req: 'KAVALLERIE', ranks: [
    [A('Hot-blooded Charge', 'Passiv', '+1 Angriffswurf, solange vollständig in feindlichem Gebiet.'), A('Terrifying Stampede', 'Passiv', 'Nach Angriff: +5 Kontrollwert bis Zugende.')],
    [A('Hardy Steeds', 'Reaktion: Rennen', 'Statt Rennwurf eine unveränderliche 6 nutzen; danach kein Angriff mehr in diesem Zug.'), A('Shrouded by Smoke', 'Passiv', 'Schussattacken gegen sie: −1 Verwunden.')],
    [A('Staggering Charge', 'Jede Nahkampfphase', 'Nach Angriff auf ein fremdes Ziel: ein Feind im Nahkampf hat STRIKE-LAST bis Zugende.'), A('Sunder Their Spears', 'Passiv', '„Anti-charge (+1 Rend)“ wirkt gegen sie nicht.')],
    [A('Furious Mounts', 'Passiv', 'In feindlichem Gebiet: Companion-Waffen haben Crit (Mortal).'), A('Ride to Glory', '1× pro Schlacht, jede Nahkampfphase', 'Auf fremdem Ziel: 2× kämpfen, nach dem ersten Mal STRIKE-LAST.')],
  ] },
  { id: 'pack', name: 'Path of the Pack', de: 'Pfad des Rudels', src: 'rc', who: 'any', req: 'BESTIE', ranks: [
    [A('Tireless Pursuers', 'Passiv', '+2" bei jeder Bewegung.'), A('Powerful Legs', 'Passiv', '+1 auf Angriffswürfe.')],
    [A("Hunter's Instinct", 'Passiv', '+1 Treffen im Nahkampf (auch Companion).'), A('Sparking Claws', 'Passiv', 'Nahkampfwaffen erhalten Crit (Auto-wound), auch Companion.')],
    [A('Scattering Pack', 'Passiv', 'Kein Ziel feindlicher RAMPAGE-Fähigkeiten.'), A('Weakening Blow', 'Jede Nahkampfphase', 'Feindliches Monster im Nahkampf: auf 3+ wirkt „Battle Damaged“ unabhängig vom Schaden.')],
    [A('Natural Armour', 'Passiv', 'Ward 5+.'), A('Frothing', 'Passiv', 'Den ersten Schadenspunkt jeder Phase ignorieren.')],
  ] },
  { id: 'behemoth', name: 'Path of the Behemoth', de: 'Pfad des Kolosses (Monster)', src: 'rc', who: 'nonhero', req: 'MONSTER', ranks: [
    [A('Lumbering Titan', 'Passiv', '+1 Lebenspunkte.'), A('Mind Set Aflame', 'Passiv', '„Battle Damaged“ wirkt nicht.')],
    [A('Burning Bloodlust', 'Reaktion: Gegner nutzt All-out Attack gegen ihn', '+1 Treffen bis Zugende (auch Companion).'), A('Agile Onslaught', 'Passiv', 'Darf Angriffswürfe wiederholen.')],
    [A('Unnatural Resilience', 'Passiv', 'Ward 6+.'), A('Furnace of Fury', 'Passiv', 'Darf 2 verschiedene RAMPAGE-Fähigkeiten pro Zug nutzen.')],
    [A('Unrestrained Aggression', 'Passiv', 'Waffen haben Crit (2 Hits), auch Companion.'), A('Obsidian Bones', 'Passiv', '+1 auf Rettungswürfe.')],
  ] },
  { id: 'artillerist', name: 'Path of the Artillerist', de: 'Pfad des Artilleristen', src: 'rc', who: 'any', req: 'KRIEGSMASCHINE', ranks: [
    [A('Surly Crew', 'Passiv', '+1 Attacke für Nahkampfwaffen.'), A('Mobile Construction', 'Passiv', '+2" bei jeder Bewegung.')],
    [A('King of the Hill', 'Passiv', 'Auf einem Ziel: feindliche Infanterie und Kavallerie können es nicht umkämpfen.'), A('Veteran Spotter', 'Passiv', 'Ignoriert „Guarded Hero“ bei der Zielwahl für Schüsse.')],
    [A('Trained Hands', '1× pro Schlacht, Reaktion: Schießen', 'Danach sofort ein zweites Mal schießen.'), A('Blackpowder Munitions', '1× pro Schlacht, Reaktion: Schießen', 'Fernkampfwaffen haben Crit (Mortal) für die Phase.')],
    [A('Perfect Trajectory', 'Passiv', 'Auf eigenem kontrolliertem Ziel: +6" Reichweite.'), A('Quick Repositioning', 'Jede Nahkampfphase', 'Nach feindlichem Angriff: bis zur Bewegungsweite wegziehen (nicht in Nahkampf enden); auf 3+ darf der Feind nicht nachrücken.')],
  ] },
  // ===== Blighted Wilds =====
  { id: 'druid', name: 'Path of the Thyrian Druid', de: 'Pfad des thyrischen Druiden', src: 'bw', who: 'hero', req: '', ranks: [
    [A('Bound to Thyria', 'Jede Heldenphase', 'Heilen (1) bei sich selbst.'), A('Forest Strider', 'Passiv', 'Darf Gelände überqueren, als hätte er FLY.')],
    [A('Skilled Healer', 'Deine Heldenphase', 'Andere befreundete Einheit oder Fraktionsgelände vollständig in 12": Heilen (W3).'), A('Deepwood Shadows', 'Passiv', 'Befreundete Einheiten vollständig in seinem Kontrollbereich sind für Feinde über 12" unsichtbar.')],
    [A('A Ghost in the Trees', 'Deine Heldenphase', 'Vollständig in 3" von Gelände: neu aufstellen im eigenen Gebiet, mehr als 9" von Feinden.'), A('Shield of Thorns', 'Jede Nahkampfphase', 'Feind, der angegriffen hat und mit ihm im Nahkampf ist: −1 Attacke bis Zugende.')],
    [A('Bound to the Cycle', '1× pro Schlacht, Bewegungsphase', 'Wenn vernichtet: Würfel ≤ Schlachtrunde → Ersatzeinheit in 3" von Gelände aufstellen.'), A('Nexus of Regeneration', '1× pro Schlacht, Ende jedes Zuges', 'Jede befreundete Einheit vollständig in 12": 1 Modell zurück ODER Heilen (W6) (Monster: 2W6).')],
  ] },
  { id: 'sacrifice', name: 'Path of the Sacrifice Master', de: 'Pfad des Opfermeisters', src: 'bw', who: 'hero', req: '', ranks: [
    [A('Willing Sacrifice', 'Passiv', '+1 Verwunden im Nahkampf, solange keine andere befreundete Einheit in Kontrollbereich ist.'), A('Seize New Offerings', 'Passiv', '+1 Treffen gegen Feinde, die keine weitere feindliche Einheit in ihrem Kontrollbereich haben.')],
    [A('Prepare the Gift', 'Passiv', '+1 Durchschlag gegen unbeschädigte Feinde.'), A('The Wilderness Demands', 'Jede Nahkampfphase', 'Nicht angegriffen: 3" bewegen, auch in den Nahkampf.')],
    [A('An Offering in Kind', 'Ende jedes Zuges', 'Hat er per Nahkampf eine Einheit vernichtet: Heilen (5); war es ein Held, komplett heilen.'), A('Marked for the Altar', '1× pro Schlacht, jede Nahkampfphase', 'Feind im Nahkampf: dessen Kontrollwert (max. 5) als Bonus-Attacken für eine Waffe, alle Attacken auf dieses Ziel.')],
    [A('We All Must Make Sacrifices...', 'Reaktion: feindlicher Befehl in 6"', 'Würfel ≥ Befehlspunkte des Gegners: so viel tödlicher Schaden bei der befehligten Einheit.'), A('Lord of Blood and Briar', 'Passiv', 'Feinde im Nahkampf mit ihm: Kontrollwert max. 1, −1 Machtstufe, keine kritischen Treffer.')],
  ] },
  { id: 'weald', name: 'Path of the Weald-born', de: 'Pfad der Waldgeborenen', src: 'bw', who: 'nonhero', req: '', ranks: [
    [A('Bursting with Vigour', 'Passiv', '+2 auf Rennwürfe, solange unbeschädigt.'), A('Sacrificial Frenzy', 'Passiv', 'Beschädigt oder Verluste (und nichts zurückgeholt): +1 Treffen im Nahkampf.')],
    [A('Greenwoad Spirals', 'Passiv', 'Ward 5+ gegen Schaden durch Zauber und Manifestationen.'), A('Growing Wildness', 'Passiv', '+ aktuelle Schlachtrunde auf den Kontrollwert.')],
    [A('Surge of Ghyran', 'Passiv', 'Wenn vernichtet: W6 tödlicher Schaden bei jedem Feind im Nahkampf mit ihnen.'), A('The Earth Rebels', '1× pro Zug (Armee), Reaktion: feindlicher Angriff in 12"', 'Einen Würfel werfen und einen Würfel des Angriffswurfs ersetzen.')],
    [A('Watchers in the Green', 'Jede Heldenphase', 'Sichtbarer Feind in 12": jeder Befehl dort wirkt auf 5+ nur, wenn ein zusätzlicher Befehlspunkt bezahlt wird.'), A('Dandegryph Blowballs', 'Gegnerische Nahkampfphase', 'Feind im Nahkampf: auf 3+ verursacht jede unmodifizierte 1 beim Treffen 1 tödlichen Schaden bei ihm selbst.')],
  ] },
  { id: 'foresters', name: 'Path of the Foresters', de: 'Pfad der Waldläufer', src: 'bw', who: 'nonhero', req: '', ranks: [
    [A('Arboreal Concealment', 'Passiv', 'Schussattacken gegen sie: −1 Treffen.'), A('Defensive Thicket', 'Jede Nahkampfphase', 'Nicht angegriffen: auf 3+ −1 Verwunden für Nahkampfattacken gegen sie.')],
    [A('Fleet-footed Fighters', 'Gegnerische Bewegungsphase', 'W3 (ohne Feinde in 9": W6); bei 2+ so viele Zoll bewegen, nicht im Nahkampf enden.'), A('Bramblebarb Burstpods', 'Jede Angriffsphase', 'Nicht angegriffen: Feind im Nahkampf erleidet W3 tödlichen Schaden.')],
    [A('Vital Souls', '1× pro Schlacht, deine Bewegungsphase', 'Nicht im Nahkampf: bis zu W3 Modelle (zusammen max. 12 Lebenspunkte) zurückholen.'), A("Hunter's Call", 'Passiv', 'Nachrücken mit FLY und 6" statt 3".')],
    [A('Trap Mastery', 'Jede Nahkampfphase', 'Feind im Nahkampf: auf 3+ −1 Attacke für dessen Nahkampfwaffen.'), A('Rooted in the Undergrowth', 'Passiv', 'Alle Modifikatoren auf ihre Rettungswürfe ignorieren.')],
  ] },
  { id: 'alchemist', name: 'Path of the Alchemist', de: 'Pfad des Alchemisten', src: 'bw', who: 'hero', req: 'Tränke-Regeln (War in the Blighted Wilds)', ranks: [
    [A('Forager', '1× pro Schlacht, Ende jedes Zuges', 'Gelände in 3": im Feindgebiet auf „Exotisch“, sonst auf „Einfach“ würfeln und Zutat erhalten.'), A('Potion Pickpocket', 'Jede Nahkampfphase', 'Feindlicher Held mit Trank im Nahkampf: auf 3+ den Trank stehlen.')],
    [A('Precious Ingredients', 'Ende jedes Zuges', 'Mit Trank: sofort ohne Schaden zurückziehen.'), A('Explosive Concoctions', 'Jede Nahkampfphase', 'Feind im Nahkampf erleidet W3+3 tödlichen Schaden.')],
    [A('Portable Brew Station', 'Deine Heldenphase', 'Sofort einen Trank mischen, wenn die Zutaten vorhanden sind.'), A('Impromptu Potions', 'Deine Schussphase', 'Feind in 12": W3 – 1: W3 tödlicher Schaden, 2: −1 Treffen, 3: keine Ward-Würfe (jeweils bis Zugende).')],
    [A('Overcharged Elixirs', 'Passiv', 'Nach Tranknutzung im selben Zug: +1 Treffen und Verwunden im Nahkampf.'), A('Waste Not, Want Not', 'Passiv', 'Bei Tranknutzung auf 5+ bleibt der Trank erhalten.')],
  ] },
  { id: 'woodsman', name: 'Path of the Woodsman', de: 'Pfad des Waldmanns', src: 'bw', who: 'hero', req: 'INFANTERIE', ranks: [
    [A('Morale Boost', 'Passiv', '+2 Kontrollwert für Befreundete vollständig in 12".'), A('Never a Stranger', 'Passiv', '+1 Rettung, solange vollständig im eigenen Gebiet.')],
    [A('Knowledgeable Guide', 'Deine Bewegungsphase', 'Er und 1 Einheit in Kontrollbereich: +2" Bewegung außerhalb des eigenen Gebiets.'), A('Expert of All Terrain', 'Passiv', 'Negative Modifikatoren auf Renn-, Angriffswürfe und Bewegung ignorieren.')],
    [A('Navigator Extraordinaire', '1× pro Schlacht (Armee), Aufstellung', 'Bis zu W3 Einheiten dürfen eine normale Bewegung machen.'), A('Traversal Gear', 'Passiv', 'Darf Gelände überqueren, als hätte er FLY.')],
    [A("Nature's Ally", '1× pro Schlacht, deine Heldenphase', 'Ziel/Gelände in Kontrollbereich: Befreundete vollständig in 12" davon haben für die Schlacht Ward 5+.'), A('Master of Hidden Paths', '1× pro Schlacht, deine Bewegungsphase', 'Er und 1 Einheit in 6": neu aufstellen auf demselben Ziel/Gelände, danach kein Angriff.')],
  ] },
];
export const pathById = id => PATHS.find(p => p.id === id || p.name === id);
export function pathsFor(packId, unit) {
  return PATHS.filter(p => (packId === 'bw' || p.src === 'rc') && (p.who === 'any' || (p.who === 'hero') === !!unit.is_hero));
}

// ---------- Ravaged Coast: Kosten & Tabellen ----------
export const RC = {
  pathCost: [0, 1, 2, 4, 6],
  enhancementCost: 3, spellCost: 2, terrainCost: 3, weaponCost: 2, rorCost: 2,
  recruitCost(points) { return points <= 100 ? 2 : points <= 200 ? 3 : points <= 300 ? 4 : points <= 400 ? 6 : points <= 500 ? 8 : points <= 600 ? 10 : 15; },
  retireRefund(points) { return points <= 200 ? 1 : points <= 300 ? 2 : points <= 400 ? 3 : points <= 500 ? 4 : 5; },
  tables: {
    outskirts: { name: 'Scorched Outskirts', die: 'W6', rows: [[1, 'Rift in the Peaks'], [2, 'Rise Through the Ashes'], [3, 'Standing on Skulls'], [4, 'Ransack the Encampment'], [5, 'Blood in the Valleys'], [6, 'Light the Fires']] },
    gnaw: { name: "Gnaw's Edge", die: 'W6', rows: [[[1, 3], 'Twisted by Rage'], [[4, 6], 'Storm the Land Bridge']] },
    shores: { name: 'Hateful Shores', die: 'W6', rows: [[[1, 2], 'Beneath the Shadow of Brazenskull'], [[3, 4], 'Assault on the Sea Cave'], [[5, 6], 'Along the Crumbling Coast']] },
    claw: { name: "Hel's Claw", die: '—', rows: [[[1, 6], "Raid on Hel's Claw"]] },
  },
  battleplans: {
    'Rift in the Peaks': 'Nord gegen Süd. Siegpunkte für gehaltene Missionsziele und Vernichtung.',
    'Rise Through the Ashes': 'Nord gegen Süd. Take and Hold: 1 SP pro kontrolliertem Ziel am Zugende.',
    'Standing on Skulls': 'West gegen Ost. 2 SP pro vernichtetem Monster, 1 SP pro anderer vernichteter Einheit.',
    'Ransack the Encampment': 'Verteidiger gegen Plünderer. Take and Hold; der Plünderer erhält zusätzlich 1 SP pro vernichteter Einheit.',
    'Blood in the Valleys': 'Vereintes gegen geteiltes Gebiet. Wer am Ende mehr Einheiten vollständig im Niemandsland hat, gewinnt.',
    'Light the Fires': 'West gegen Ost. Take and Hold an den Kohlebecken.',
    'Twisted by Rage': 'Henker gegen Gejagten. Stirbt der General des Gejagten, gewinnt der Henker – sonst der Gejagte.',
    'Storm the Land Bridge': 'Ein einziges Ziel in der Mitte (Umkämpfende haben STRIKE-LAST). Wer es am Ende hält, gewinnt.',
    'Beneath the Shadow of Brazenskull': 'Grenz- gegen Zentralgebiet. Wer am Ende mehr Ziele hält, gewinnt.',
    'Assault on the Sea Cave': 'Plünderer gegen Hortenden. Der Plünderer darf kontrollierte Ziele entfernen; 0 Ziele = Plünderer siegt, 1 = Unentschieden, 2+ = Hortender siegt.',
    'Along the Crumbling Coast': 'Bröckel- gegen Neuland-Gebiete. Take and Hold plus Bonus für unbestrittene Ziele.',
    "Raid on Hel's Claw": 'Finale! Beide Armeen in zwei Kontingenten. Wer am Ende den Emberstone-Hort trägt, gewinnt die Kampagne.',
  },
  twistTable: [[1, 'Kein Twist in dieser Schlacht'], [2, 'Volcanic Incandescence'], [3, 'Mounting Corruption'], [4, 'Ash Storm'], [5, 'Raging Winds'], [6, 'Der Spieler mit dem niedrigsten General-Rang wählt die Tabelle (bei Gleichstand neu würfeln)']],
  twists: {
    'Volcanic Incandescence': [['1–2', 'Steam Vent: Underdog wählt Gelände im Niemandsland – W3 tödlicher Schaden an jeder Einheit in 1".'], ['3–4', 'Magmic Blast: Underdog wählt ein Ziel – je umkämpfender Einheit W3, ab 2+ so viel tödlicher Schaden.'], ['5', 'Pyroclastic Flow: eine befreundete Einheit +1 auf Angriffswürfe für die Runde.'], ['6', 'Emberstone Uncovered: zusätzlicher Emberstone-Cluster (über 6" von allem).']],
    'Mounting Corruption': [['1–2', 'Verminous Infestation: Feind auf einem vom Underdog kontrollierten Ziel hat STRIKE-LAST.'], ['3–4', 'Unnatural Empowerment: eine befreundete Einheit +5 Kontrollwert.'], ['5', "Rabid Plunderers: Underdog darf 'Collect Emberstone' wiederholen."], ['6', 'Emberstone Uncovered.']],
    'Ash Storm': [['1–2', 'Cinder Squall: eine befreundete Einheit kann von Schützen über 12" nicht beschossen werden.'], ['3–4', 'Claggy Sands: ein Feind −2 auf Rennwürfe.'], ['5', 'Soot Rain: kein tödlicher Schaden durch Rückzug für den Underdog.'], ['6', 'Emberstone Uncovered.']],
    'Raging Winds': [['1–2', 'Blistering Wrath: eine befreundete Einheit +1 Verwunden im Nahkampf.'], ['3–4', 'Untempered Indignation: Nahkampfattacken gegen Einheiten auf einem gewählten Ziel +1 Treffen.'], ['5', 'Furious Storm: eine Einheit +1 Attacke gegen Feinde, die diesen Zug angegriffen haben.'], ['6', 'Emberstone Uncovered.']],
  },
  scars: {
    serious: [['1–2', 'Smouldering Scars', 'Am Schlachtende W6: bei 5+ W3 Kampfwunden.'], ['3–4', 'Unyielding Blisters', 'Schadenspunkte an dieser Einheit können nicht geheilt werden.'], ['5–6', 'Scorched Limbs', '−1 auf Renn- und Angriffswürfe.']],
    severe: [['1–2', 'Blood-deep Corruption', 'Kann nicht rennen oder sich zurückziehen.'], ['3–4', 'Warp-rust', 'Beim Kämpfen auf 4+: Nahkampfwaffen ohne Waffenfähigkeiten bis Zugende.'], ['5–6', 'Endless Chittering', 'Befehle für diese Einheit wirken auf 4+ nicht (Punkte trotzdem weg).']],
    critical: [['1–2', 'Hissing Wheezes', 'Hat STRIKE-LAST.'], ['3–4', 'Ash-blighted', '−1 Attacke für alle Waffen.'], ['5–6', 'Raging Agonies', 'Jede Nicht-Core-Fähigkeit wirkt auf 5+ nicht.']],
  },
  forge: {
    base: {
      ranged: { type: 'ranged', rng: 15, atk: { d: 3, p: 1 }, hit: 4, wnd: 3, rnd: 1, dmg: { d: 3, p: 0 }, abilities: [] },
      melee: { type: 'melee', rng: 0, atk: { d: 6, p: 1 }, hit: 4, wnd: 3, rnd: 1, dmg: { d: 3, p: 0 }, abilities: [] },
    },
    // [Zeile = 2. Würfel][Spalte = 1. Würfel]
    table: [
      [['hit-1', 'wnd+2'], ['hit-1', 'rnd+2'], ['hit-1', 'dmg+2'], ['hit-1', 'atk+2'], ['ab:Crit (Auto-wound)'], ['fail']],
      [['hit+1'], ['atk-1', 'wnd+1'], ['atk-1', 'rnd+2'], ['dmg+1'], ['fail'], ['ab:Crit (2 Hits)']],
      [['wnd-1', 'atk+2'], ['wnd-1', 'rnd+2'], ['ab:Crit (Mortal)'], ['fail'], ['wnd-1', 'dmg+2'], ['wnd-1', 'rnd+2']],
      [['hit+1'], ['wnd+1'], ['fail'], ['ab:Anti-INFANTERIE (+1 Rend)'], ['rngatk'], ['dmg+1']],
      [['rngatk'], ['fail'], ['ab:Anti-MONSTER (+1 Rend)'], ['ab:Crit (Auto-wound)'], ['ab:Anti-KRIEGSMASCHINE (+1 Rend)'], ['ab:Anti-MANIFESTATION (+1 Rend)']],
      [['fail'], ['hit+1'], ['wnd+1'], ['atk-1', 'rnd+1', 'dmg+1'], ['ab:Anti-KAVALLERIE (+1 Rend)'], ['ab:Anti-HELD (+1 Rend)']],
    ],
  },
  regimentsOfRenown: [
    { name: 'The Realmstone Innovator', alliance: 'Ordnung', fx: 'Held (Infanterie). Darf in jedem Aftermath 1 Schmiedewurf wiederholen. „Field Modifications“: verbessert die Emberstone-Waffe eines Helden in der Nähe (bei 1 tödlicher Schaden).' },
    { name: 'The Warped Saboteur', alliance: 'Chaos', fx: 'Held (Infanterie). 1 Schmiedewurf pro Aftermath wiederholen. „Arcane Sabotage“: zerstört auf 3–5 die Emberstone-Waffe eines Feindes in 6" (W3 tödlicher Schaden); sie wird vom Roster gestrichen.' },
    { name: 'The Sinister Nullifier', alliance: 'Tod', fx: 'Held (Infanterie). 1 Schmiedewurf pro Aftermath wiederholen. Befreundete in 12" erhalten Ward gegen Schaden durch Emberstone-Waffen.' },
    { name: 'The Weird-crafta', alliance: 'Zerstörung', fx: 'Held (Infanterie). 1 Schmiedewurf pro Aftermath wiederholen. „Try Dis On Fer Size!“: Emberstone-Waffe eines Helden +1 Schaden, aber 1er beim Treffen verletzen den Träger.' },
  ],
  enhancements: {
    traits: [['Words of Blazing Power', '+1 auf Zauberwürfe für Zauber der Lore of Magmic Fury.'], ['Spiteful Spark', 'Nahkampfphase: jeder Feind im Nahkampf erleidet auf 2+ 1 tödlichen Schaden.'], ['Tainted Radiance', 'Feinde im Nahkampf mit ihm: −3 Kontrollwert.'], ['Brash and Angry', '1× pro Schlacht: auf einen Angriff in 9" mit einem eigenen Gegenangriff reagieren (danach STRIKE-LAST).'], ['Forthright Fury', 'Rennwürfe von 1–3 für Befreundete in 12" zählen als 4.'], ['Live on the Edge', 'Ward 4+ gegen Schaden aus Schuss-Fähigkeiten.']],
    artefacts: [['Axe of Boiling Wrath', 'Aufstellung: feindlichen Helden wählen – gegen ihn +1 Verwunden und Anti-Held, muss ihn angreifen.'], ['Sparking Shield', 'Jede unmodifizierte 1 beim Treffen gegen ihn: 1 tödlicher Schaden beim Angreifer.'], ['Cremated Pendant', '+ doppelte Schlachtrunde auf den Kontrollwert.'], ['Warpmock Blade', 'Eine Nahkampfwaffe übernimmt die Waffenfähigkeiten der Gegner im Nahkampf.'], ['Magmic Key', '1× pro Schlacht: neu aufstellen, mehr als 9" von Feinden.'], ['Carved Magmadroth Horn', 'Rally in 12": 3 zusätzliche Rally-Würfel.']],
    spells: [['Pyroclastic Repression (6, Unlimited)', 'Feind in 18": −2 auf Renn- und Angriffswürfe.'], ['Flaming Blades of Ruin (7)', 'Einheit in 12": W3 tödlicher Schaden, aber +1 Attacke im Nahkampf.'], ['Volcanic Blast (7)', 'Gelände in 12": W3 tödlicher Schaden an allen Einheiten in 3".'], ['Fulminating Flame-cage (7)', 'Feind in 18": bei jeder Fähigkeit auf 4+ 1 tödlicher Schaden.'], ['Embody the Blaze (8)', 'Befreundete Einheit im Nahkampf kämpft sofort, danach STRIKE-LAST.'], ['Cascading Fire Cloak (6)', 'Zauberer erhält Ward 5+.']],
    prayers: [['Burning Insistence (4, Unlimited)', '+3 Kontrollwert (bei 8+: +10).'], ['Invocation to Wrath (4)', '+1 Verwunden im Nahkampf (bei 8+: 2 Ziele).'], ['Trail of Lava (4)', 'Rückzug ohne Schaden und trotzdem schießen/angreifen; bei 8+ W3 Schaden an Verfolgern.'], ['Cauterisation (4)', 'Feind in 18": Waffenfähigkeiten aus (außer Companion); bei 10+ verletzen eigene 1er.'], ['Leaping Embers (4)', '+2 auf Angriffswürfe (bei 8+: +4).'], ['Crumbling Impact (4)', 'Feinde, die in 3" angreifen: W3 tödlicher Schaden (bei 8+: W6).']],
  },
};

// ---------- Blighted Wilds ----------
export const BW = {
  gpTable: {
    brackets: ['< 1000', '1000–1250', '1251–1500', '1501–2000', '> 2000'],
    fought: [60, 110, 150, 180, 200],
    major: [30, 40, 50, 55, 60],
    minor: [20, 30, 40, 45, 50],
    generalAlive: [10, 15, 20, 25, 30],
  },
  bracket(points) { return points < 1000 ? 0 : points <= 1250 ? 1 : points <= 1500 ? 2 : points <= 2000 ? 3 : 4; },
  rankFor(renown) { return renown >= 45 ? 4 : renown >= 30 ? 3 : renown >= 15 ? 2 : renown >= 5 ? 1 : 0; },
  rankMin: [0, 5, 15, 30, 45],
  maxRegiments: 5,
  battleplans: {
    "Thyria's Bounty": { win: 'Ab Runde 3: wer eine Ernte-Marke an eigener Zutaten-Gruppe hat (und der Gegner nicht), gewinnt sofort; sonst nach Siegpunkten.', ability: ['Sanitised', 'Nächste Schlacht: +1 auf Reinigungswürfe.'], misc: 'Eine Verbesserung ODER einen Zauber/ein Gebet.' },
    'Forest Fortress': { win: 'Angreifer gegen Verteidiger: Ist die Festung am Ende zerstört, gewinnt der Angreifer, sonst der Verteidiger.', ability: ['Expert Garrison', '1× pro Schlacht: Einheit in 3" von Gelände/Ziel +1 Rettung bis Zugende.'], misc: 'Eine Verbesserung ODER einen Zauber/ein Gebet.' },
    'A Dense and Choking Maze': { win: 'Siegpunkte für kontrollierte Navigations-Wegmarken (3 SP) plus Bonus für unbestrittene (2 SP). Kleiner Sieg: W6 – bei 5–6 bekommt der Gegner die Belohnungswahl.', ability: ['Tactical Repositioning', '1× pro Schlacht: Einheit bewegt sich 2W6" (nicht in den Nahkampf).'], misc: 'Einen Zauber/ein Gebet.' },
    'Cursed Kernel': { win: 'Liegt der Fäulnis-Samen am Ende vollständig in deinem Gebiet, gewinnt der Gegner. Sonst Unentschieden.', ability: ['Wyrdron Seed', '1× pro Schlacht: Feind in 9" eines Helden – 1–2: weniger Angriffswürfel, 3+: so viel tödlicher Schaden.'], misc: 'Eine zweite Einheit als „Favoured Warriors“ wählen.' },
    'Escort to the Wellspring Grove': { win: 'Begleiter gegen Hinterhalt: erreicht der Verwundete den Fluchtweg, gewinnt der Begleiter – sonst der Hinterhalt.', ability: ['Defiant in the Face of Danger', '1× pro Schlacht: Waffenfähigkeiten eines Feindes wirken bis Zugende nicht.'], misc: 'Einen Zauber/ein Gebet.' },
    'Nexuses of Contamination': { win: 'Wer mehr Gelände gereinigt hat, gewinnt. Gleichstand = Unentschieden.', ability: ['Proven Survivors', '1× pro Schlacht: eine Einheit Ward 5+ für einen Zug.'], misc: 'Eine Einheit dieser Schlacht verliert W3+3 Kampfwunden.' },
    'Precarious Crossing': { win: 'Erreicht die Brücken-Stabilisierung 120+ und du kontrollierst die Brücke, gewinnst du. Sonst Unentschieden.', ability: ['Dauntless', '1× pro Schlacht: bis zu W3 Einheiten bewegen sich in der Aufstellung.'], misc: '10W6 Ruhmespunkte.' },
    'Emergency Foraging': { win: 'Ab Runde 3 Siegbedingung über gesammelte Vorräte (siehe Battleplan).', ability: ['Spiteful Attitude', '1× pro Schlacht: −1 Verwunden im Nahkampf gegen eine Einheit.'], misc: 'Eine Verbesserung ODER einen Zauber/ein Gebet.' },
    'The Call of Sacrifice': { win: 'Opfer-Mechanik und Siegpunkte (siehe Battleplan).', ability: ['One with Thyria', '1× pro Schlacht: feindlicher Held in 18" deines Generals −1 Rettung und Ward.'], misc: 'Eine Verbesserung ODER einen Zauber/ein Gebet.' },
    'Vital Alignment': { win: 'Kontrollierst du am Zugende alle 4 Leylinien-Knoten, gewinnst du sofort; sonst nach Siegpunkten.', ability: ['Empowered by Ghyran', '1× pro Schlacht: Held +1 Machtstufe oder wird Zauberer/Priester (1).'], misc: 'Eine Kampfnarbe einer Einheit entfernen.' },
    'Creeping Rootstalks': { win: 'Arboreal Guardian: 5 SP pro kontrolliertem Mutterbaum am Zugende.', ability: ['Briarseed Blessings', '1× pro Schlacht: Einheit, die angegriffen hat: W3 → +1 Attacke / Durchschlag / Schaden.'], misc: 'Eine kostenlose Eigenart für das Regiment of Ghyran oder ein Upgrade für die Landmark of Ghyran.' },
    'Be It Purity or Putrescence': { win: 'Finale: Die Quelle der Verderbnis. Großer Sieg = Kampagnensieg (danach W6 Kampfwunden je Einheit heilen und eine Narbe entfernen).', ability: ['Purifiers of the Blighted Wilds', 'Trophäe: 1× pro Schlacht Heilen (3) bei jeder befreundeten Einheit – auch in künftigen Kampagnen.'], misc: '—' },
  },
  scars: {
    serious: [['1–2', 'Cyclical Melancholy', '−10 eigener Kontrollwert, aber +3 für Befreundete vollständig in Kontrollbereich.'], ['3–4', 'Splinterskin', 'Schüsse aus 12" oder näher +1 Verwunden, aus über 12" −1.'], ['5–6', 'Graspspite Musk', 'Rennen und „Redeploy“ mit W3; Feinde, die sich aus dem Nahkampf zurückziehen, erleiden W6 statt W3.']],
    severe: [['1–2', 'Aether-rot', 'Alle Einheiten in 6": −1 auf Zauber- und Gebetswürfe.'], ['3–4', 'Abject Apathy', 'STRIKE-FIRST und STRIKE-LAST wirken auf sie nicht.'], ['5–6', 'Monomaniacal Defenders', 'Beschädigt: kein Nachrücken und keine Befehle, aber +1 Rettung.']],
    critical: [['1–2', 'Thin Blood, Stout Hearts', 'Nahkampf gegen sie +1 Durchschlag; bei Rally 1 zusätzlicher Würfel.'], ['3–4', 'Deepwood Mania', 'Treffer nur noch auf 5+ (dafür kritisch), 1–4 scheitern immer.'], ['5–6', 'Parasitic Clusters', 'Muss immer in 1" der Spielfeldkante und mehr als 9" von allen Einheiten aufgestellt werden.']],
  },
  enhancements: {
    traits: [['Blessed by the Old Magics', '1× pro Schlacht: Zauber der Overgrown Wilds gelingt mit fester 9; wird er gebannt, W6 tödlicher Schaden beim Banner.'], ['Grizzled Survivalist', 'Positive Treffer-/Verwundungsmodifikatoren für Schüsse gegen ihn ignorieren.'], ['Resolute Builder', 'In 3" eigenen Fraktionsgeländes oder Geländes im eigenen Gebiet: Ward 5+.'], ['Arcane Disruptor', 'Manifestation in 6": auf 5+ gebannt.'], ['As Strong as an Ironoak', '+2 Kontrollwert pro erlittenem Schadenspunkt.'], ['Natural Terror', '1× pro Schlacht: sichtbarer Feind hat Kontrollwert max. 1.']],
    artefacts: [['Jadecurse Stave', 'Gegen seinen Nahkampfschaden keine Ward-Würfe.'], ['Thorn-studded Gauntlets', 'Ende jedes Zuges: 1 tödlicher Schaden an jedem sichtbaren Feind in 6".'], ["Princeling's Bow", 'Schussphase: Feind in 18" – 3 Würfel, je 4+ 1 tödlicher Schaden.'], ['Barkflesh Shield', 'Ersten Schadenspunkt jeder Phase ignorieren.'], ['Revivifying Philtre', '1× pro Schlacht: Heilen (W3+3) und Ward 5+ bis Zugende.'], ['Arcane Seedpod', '1× pro Schlacht: Feinde in 3" eines Geländes −1 Zauber/Gebet, halbe Bewegung, kein FLY.']],
    spells: [['Thicket Shield (6, Unlimited)', 'Ziel in 3" von Gelände: für Feinde über 9" unsichtbar.'], ['Disrupt the Humours (5)', 'Feind: −1 auf Verseuchungs- und Reinigungswürfe.'], ['Healing Spiral (7)', 'Nach dem Kämpfen Heilen (X) = getötete Modelle.'], ['Awaken the Carnivores (7)', 'Gelände: Einheiten in 3" −1 Rettung.'], ['Shifting Lands (6)', 'Feinde dürfen nicht in 12" eines Geländes aufgestellt werden.'], ['Forest Walk (6)', 'Bewegung des Zauberers verdoppeln.']],
    prayers: [['Spring in Their Step (3, Unlimited)', '+1 Angriff in 3" eines Geländes (6+: +2).'], ['Jade Revival (4)', 'Modelle mit bis zu 4 Lebenspunkten zurückholen (8+: 8).'], ['The Angry Wilds (5)', 'Befehle des Ziels kosten 1 Punkt mehr (10+: keine Befehle).'], ['Rooted Delusion (4)', 'Ziel hat STRIKE-LAST (8+: zusätzlich −1 Verwunden).'], ['Regenerating Blossom (4)', 'Heilen (W3) in 3" eines Geländes (8+: Heilen 3).'], ['Soporific Soothing (4)', 'Ziel kann keine kritischen Treffer erzielen (9+: Crit gegen es auf 5+).']],
  },
  ingredients: {
    basic: [[1, null], [2, 'Ironthorn Stamen'], [3, 'Leaping Moss'], [4, 'Bloodweed Nectar'], [5, 'Jaderoot Thistle'], [6, 'pick-or-exotic']],
    exotic: [[1, 'pick-basic'], [2, 'Fresh Aetherblossom'], [3, 'Whisperwood Bark'], [4, 'Magevine Root'], [5, 'Aqua Ghyranis'], [6, 'pick-any']],
  },
  concoctions: [
    { name: 'Revitaliser', recipe: { 'Ironthorn Stamen': 2, 'Jaderoot Thistle': 1 }, fx: 'Heilen (6) bei einer befreundeten Einheit in Kontrollbereich.' },
    { name: "Durthu's Fury", recipe: { 'Leaping Moss': 2, 'Bloodweed Nectar': 1 }, fx: '+1 Schaden im Nahkampf (Infanterie: +W3) bis Zugende.' },
    { name: 'Ghyranite Vitality', recipe: { 'Ironthorn Stamen': 1, 'Bloodweed Nectar': 1, 'Leaping Moss': 1 }, fx: 'Held in Kontrollbereich: +1 Rennen, Angriff und Rettung bis Zugende.' },
    { name: 'Aelf Step', recipe: { 'Jaderoot Thistle': 2, 'Fresh Aetherblossom': 1 }, fx: 'Neu aufstellen in 3" einer befreundeten Einheit, mehr als 9" von Feinden.' },
    { name: "Dr Rothil's Rat Repellent", recipe: { 'Bloodweed Nectar': 1, 'Leaping Moss': 1, 'Whisperwood Bark': 1 }, fx: 'Feind in 12": je Modell ein Würfel, jede 5+ = 1 tödlicher Schaden.' },
    { name: 'Verdant Mist', recipe: { 'Ironthorn Stamen': 2, 'Magevine Root': 1 }, fx: 'Jede Nicht-Monster-Einheit in 12" (Freund und Feind) erhält 1 Modell zurück.' },
    { name: 'Blisterbrew', recipe: { 'Bloodweed Nectar': 2, 'Aqua Ghyranis': 1 }, fx: 'Feind in 12": für die Schlacht 1 tödlicher Schaden nach jeder Bewegung/jedem Kampf.' },
    { name: 'Elixir of Enlightenment', recipe: { 'Fresh Aetherblossom': 2, 'Magevine Root': 1 }, fx: 'Nächster Zauberwurf mit 3W6.' },
    { name: 'Chameleon Vapour', recipe: { 'Whisperwood Bark': 2, 'Aqua Ghyranis': 1 }, fx: 'Befreundete Infanterie in 12" für Feinde über 6" unsichtbar.' },
  ],
  sideEffects: [[1, 'Allergic Reaction: W6 tödlicher Schaden an den Zielen.'], [2, 'Drowsiness: −2" Bewegung.'], [3, 'Nausea: kann keine Ziele umkämpfen.'], [4, 'Painful Rash: −1 Rettung.'], [5, 'Splitting Headache: keine Befehle.'], [6, 'Keine Nebenwirkung.']],
  landmarkSizes: [['Imposing Monument', 15, 20], ['Spectacular Edifice', 20, 70], ['Breathtaking Monolith', 30, 120]],
  regimentSizes: [['Acclaimed Retinue', 15, 150], ['Pre-eminent Warband', 30, 300], ['Illustrious Battalion', 50, 500]],
};

export const SCAR_LEVELS = [['serious', 'Ernste Narbe', 5], ['severe', 'Schwere Narbe', 9], ['critical', 'Kritische Narbe', 13]];
export function scarLevelFor(w) { return w >= 18 ? 'dead' : w >= 13 ? 'critical' : w >= 9 ? 'severe' : w >= 5 ? 'serious' : null; }
export function scarTable(packId) { return packId === 'bw' ? BW.scars : RC.scars; }
export function rollOnRange(rows, roll) {
  for (const r of rows) {
    const k = r[0];
    if (Array.isArray(k) ? roll >= k[0] && roll <= k[1] : typeof k === 'number' ? roll === k : (() => { const [a, b] = String(k).split('–').map(Number); return roll >= a && roll <= (b || a); })()) return r;
  }
  return null;
}

// Emberstone-Schmiede: Waffenprofil verändern
const fmtDice = (o) => (o.d ? 'W' + o.d : '') + (o.p > 0 ? (o.d ? '+' : '') + o.p : o.p < 0 ? String(o.p) : (o.d ? '' : '0'));
export function weaponText(w) {
  return `${w.type === 'ranged' ? 'Fernkampf ' + w.rng + '" · ' : 'Nahkampf · '}Atk ${fmtDice(w.atk)} · Tr ${w.hit}+ · Vw ${w.wnd}+ · DS ${w.rnd} · Sch ${fmtDice(w.dmg)}${w.abilities.length ? ' · ' + w.abilities.join(', ') : ''}`;
}
export function forgeApply(weapon, c1, c2) {
  const effects = RC.forge.table[c2 - 1][c1 - 1];
  const w = JSON.parse(JSON.stringify(weapon));
  const desc = [];
  for (const e of effects) {
    if (e === 'fail') return { weapon, text: 'Fehlschlag – keine Änderung', failed: true };
    if (e.startsWith('ab:')) {
      const ab = e.slice(3);
      if (w.abilities.includes(ab)) return { weapon, text: `${ab} (schon vorhanden) – zählt als Fehlschlag`, failed: true };
      w.abilities.push(ab); desc.push(ab); continue;
    }
    if (e === 'rngatk') {
      if (w.type === 'ranged') { if (w.rng + 3 > 30) return { weapon, text: 'Reichweite schon am Maximum – Fehlschlag', failed: true }; w.rng += 3; desc.push('+3" Reichweite'); }
      else { w.atk.p += 1; desc.push('+1 Attacke'); }
      continue;
    }
    const m = e.match(/^(hit|wnd|rnd|dmg|atk)([+-]\d)$/);
    const k = m[1], v = Number(m[2]);
    if (k === 'hit' || k === 'wnd') {
      const nv = w[k] - v; // +1 Hit verbessert 4+ → 3+
      if (nv < 2) return { weapon, text: 'Wert schon am Maximum (2+) – Fehlschlag', failed: true };
      w[k] = Math.min(6, nv);
    } else if (k === 'rnd') {
      if (w.rnd + v > 4) return { weapon, text: 'Durchschlag schon am Maximum (4) – Fehlschlag', failed: true };
      w.rnd += v;
    } else if (k === 'dmg') {
      if (w.dmg.p + v > 4) return { weapon, text: 'Schaden schon am Maximum (W3+4) – Fehlschlag', failed: true };
      w.dmg.p += v;
    } else if (k === 'atk') w.atk.p += v;
    desc.push({ hit: 'Treffen', wnd: 'Verwunden', rnd: 'Durchschlag', dmg: 'Schaden', atk: 'Attacken' }[k] + ' ' + (v > 0 ? '+' : '') + v);
  }
  return { weapon: w, text: desc.join(', ') };
}

// ---------- Regelwerk-Kapitel (Nachschlagen) ----------
export function rulebook(packId) {
  const common = [
    { id: 'ablauf', title: 'So läuft eine Runde in der App', body: [
      'Jede Runde hat drei Phasen: **Zug** → **Schlachten** → **Aftermath**.',
      '**Zug:** Jeder wählt geheim ein Feld. Erst wenn alle gezogen haben, deckt die App alle Züge gleichzeitig auf.',
      '**Begegnungen:** Stehen zwei Spieler auf demselben Feld, kämpfen sie gegeneinander. Wer allein steht, wird mit einem anderen Spieler gepaart, der ebenfalls allein steht. Bleibt einer übrig, kämpft er gegen einen Gastspieler (eine außenstehende Person).',
      '**Ergebnis:** Ein Beteiligter trägt Sieger, Siegpunkte und Verluste ein. Der Sieger übernimmt sein Feld; wer auf demselben Feld verliert, zieht sich auf sein vorheriges Feld zurück.',
      '**Aftermath:** Danach geht jeder Spieler den Aftermath-Assistenten durch. Sind alle Spiele und Aftermaths fertig, startet die nächste Runde automatisch.',
      'Der Master kann jederzeit Züge aufdecken, die Runde weiterschalten, Spieler entfernen und PINs zurücksetzen.',
    ] },
    { id: 'roster', title: 'Roster erstellen', body: packId === 'bw' ? [
      '**Startpunkte:** empfohlen 1000 Punkte.',
      '**Reihenfolge:** Fraktion → (Kampfformation) → General → Regimenter → (Regiment of Ghyran) → Hilfseinheiten → (Fraktionsgelände und/oder Landmark of Ghyran) → Pfad des Generals → Verbesserungen, Zauber und Gebete.',
      '**General:** 1 Held deiner Fraktion, Einzelmodell, führt sein eigenes Regiment mit bis zu 4 Nicht-Helden.',
      '**Weitere Regimenter:** bis zu 4 (insgesamt max. 5) – je 1 Held derselben Großen Allianz + bis zu 3 Nicht-Helden mit seinem Fraktions-Schlüsselwort.',
      '**Hilfseinheiten (Auxiliary):** beliebig viele; wer weniger hat, bekommt pro Runde 1 Befehlspunkt extra.',
      '**Verstärkt:** doppelte Mindestgröße zu doppelten Punkten (nicht bei Größe 1).',
      '**Start-Verbesserungen:** 1 Heldeneigenschaft und 1 Artefakt (aus deinem Battletome oder Pride of Thyria / Thyrian Wonders).',
      '**Arcane Tome:** bis zu 3 Zauber aus 1 Lore, 3 Gebete aus 1 Lore, 3 Beschwörungen aus 1 Manifestations-Lore. Maximal 6 normale + 3 Beschwörungsplätze.',
      '**General:** startet mit 5 Ruhm (Renown) und Rang Aspiring – wähle sofort Pfad und eine Aspiring-Fähigkeit.',
      '**Einzigartige Einheiten** werden nicht empfohlen; wenn erlaubt, bekommen sie weder Verbesserungen noch Pfade.',
    ] : [
      '**Startpunkte:** 1000 Punkte, höchstens 350 Punkte für eine einzelne Einheit (Ausnahme: Helden bei Behemats Söhnen).',
      '**Reihenfolge:** Fraktion → (Kampfformation) → General → Regimenter → Hilfseinheiten → Pfad des Generals → bis zu 2 Zauber (wenn Zauberer) und 2 Gebete (wenn Priester).',
      '**General:** 1 Held deiner Fraktion, Einzelmodell, führt sein Regiment mit bis zu 4 Nicht-Helden.',
      '**Weitere Regimenter:** bis zu 4 – je 1 Held derselben Großen Allianz + bis zu 3 Nicht-Helden mit seinem Fraktions-Schlüsselwort.',
      '**Hilfseinheiten (Auxiliary):** beliebig viele; wer weniger hat, bekommt pro Runde 1 Befehlspunkt extra.',
      '**Verstärkt:** doppelte Mindestgröße zu doppelten Punkten (nicht bei Größe 1 oder wenn das Profil es verbietet).',
      '**Keine Start-Verbesserungen und kein Fraktionsgelände** – beides kommt später über Splitter.',
      '**Arcane Tome:** 1 UNLIMITED-Zauber deiner Fraktion + 1 Zauber beim ersten Zauberer; dasselbe für Gebete. Maximal 6 Einträge.',
      '**General** startet auf Rang Aspiring: Pfad und eine Aspiring-Fähigkeit sofort wählen.',
      '**Ravaged Coast Regiment of Renown:** max. 1, nur die 4 Regimenter aus diesem Battlepack, kann nicht General sein.',
    ] },
    ...(packId === 'bw' ? [
      { id: 'schlacht', title: 'Vor der Schlacht', body: [
        '**Schlachtplan:** Der Spieler mit dem niedrigsten General-Rang wählt einen Schlachtplan, den **beide** freigeschaltet haben (am Anfang nur Thyria\'s Bounty und Forest Fortress). Gleicher Rang: Würfeln, der Gewinner wählt.',
        '**Routen entdecken:** Thyrian Paths (durchgezogen) werden nach einer Schlacht mit diesem Schlachtplan entdeckt. Concealed Trails (rot) erst nach einem Sieg mit diesem Schlachtplan. In der App gilt: Wer mit dem Plan gewonnen hat, entdeckt dessen verborgene Pfade.',
        '**Verseuchung:** Abwechselnd je ein Gelände außerhalb des eigenen Gebiets verseuchen, dann jedes übrige Gelände auf 4+ verseucht (nicht Fraktionsgelände/Landmark).',
        '**Ruhende Einheit:** Jeder darf 1 Einheit ruhen lassen – sie spielt nicht mit und zählt nicht zu den Punkten. Im Aftermath heilt sie W6 Kampfwunden.',
        '**Ungleiche Armeen:** Ab 100 Punkten Unterschied hat die größere Armee eine Übermacht. Überschuss = Differenz − 100. So viele Punkte müssen als „Stalled Reinforcements“ in Reserve (ab Runde 2 auf 4+ einsetzbar; −1 für Held/verstärkt, −1 für Monster).',
        '**Underdog:** wer weniger Siegpunkte hat. Wer die Initiative ergreift (als Zweiter den Prioritätswurf gewinnt und zuerst zieht), macht seinen Gegner für den Rest der Schlacht zum Underdog.',
        '**Blighted Waters (Pflicht, jeder Zug):** zufälliges verseuchtes Gelände – Einheiten in 3" machen einen Verseuchungswurf (W3): 1 = 1 tödlicher Schaden, 2+ = STRIKE-LAST.',
        '**Purify the Land (Ende jedes Zuges):** Einheit in 3" eines verseuchten Geländes, W6 – ab 3+ für dich gereinigt und die Einheit erhält 2 Ruhm.',
        '**Boon of Vitality (Bewegungsphase):** Einheit in 3" eines von dir gereinigten Geländes: W6 → 3: +1 Rennen/Angriff, 4: −1 Verwunden gegen sie, 5: Ward 5+, 6: kostenloses Rally mit 3 Extra-Würfeln.',
        '**Schlachtlänge:** Nach Runde 4 auf 1–2 Schluss, nach Runde 5 auf 1–4 Schluss, nach Runde 6 immer Schluss.',
        '**Rückzug:** Zu Beginn deines Zuges, wenn mindestens die Hälfte deiner Startarmee vernichtet ist – der Gegner erhält einen großen Sieg.',
        '**Sieg:** Mehr Siegpunkte = großer Sieg. Gleichstand: wer mehr Gelände gereinigt hat, erhält einen kleinen Sieg; sonst Unentschieden.',
      ] },
    ] : [
      { id: 'schlacht', title: 'Vor der Schlacht', body: [
        '**Schlachtplan:** Der Spieler mit dem niedrigsten General-Rang würfelt auf der Tabelle. Die App wählt die Tabelle nach der Zone, in der gekämpft wird (bei Paarungen über die Karte die niedrigere Zone).',
        '**Freischaltung:** Gnaw\'s Edge ab 20 insgesamt gesammelten Splittern · Hateful Shores nach einem Sieg in Gnaw\'s Edge · Hel\'s Claw nach einem Sieg in den Hateful Shores.',
        '**Emberstone-Cluster:** W3+1 Stück (Hateful Shores: W6), 40-mm-Marker, mehr als 6" von Kanten, Zielen und anderen Clustern; die ersten 2 ins Niemandsland.',
        '**Collect Emberstone (Ende deines Zuges, 1× pro Armee):** Kontrollierter Cluster, Einheit in 3": 1 = W3 tödlicher Schaden an allen in 3", 2–6 = Emberstone-Marke.',
        '**Filled with Fury:** Mit Marke −1 auf Rettung, +1 auf Verwunden. Stirbt die Einheit, fällt der Cluster wieder auf das Feld.',
        '**Dig for Emberstone (Schlachtende):** Für jedes kontrollierte Ziel eine Einheit: 1 = 1 Kampfwunde, 4+ = Emberstone-Marke.',
        '**Ungleiche Armeen:** Ab 200 Punkten Unterschied: Überschuss = Differenz − 200; so viele Punkte als „Stalled Reinforcements“ in Reserve (auf 4+ in der Bewegungsphase einsetzbar).',
        '**Twists:** Würfle auf der Twist-Tabelle; der Underdog (weniger Siegpunkte) würfelt jede Runde auf der gewählten Twist-Tabelle.',
        '**Aqshian Anger:** Wer „All-out Attack“ nutzt, wird für die Phase leichter getroffen (+1 Treffen gegen ihn).',
        '**Schlachtlänge:** Nach Runde 4 auf 1–2 Schluss, nach Runde 5 auf 1–4 Schluss, nach Runde 6 immer.',
        '**Rückzug:** Zu Beginn deiner Heldenphase, wenn mindestens die Hälfte deiner Startarmee vernichtet ist – der Gegner erhält einen großen Sieg.',
      ] },
    ]),
    packId === 'bw' ? { id: 'aftermath', title: 'Aftermath: Ruhm, Ränge und Ausbau', body: [
      '**1. Ruhmespunkte (GP):** nach Punkten der gegnerischen Armee – gekämpft 60/110/150/180/200, großer Sieg +30/40/50/55/60, kleiner Sieg +20/30/40/45/50, General überlebt +10/15/20/25/30 (Spalten: <1000, 1000–1250, 1251–1500, 1501–2000, >2000).',
      '**Belohnungen:** Nach großem Sieg wählt der Sieger Fähigkeits- oder Sonstige Belohnung des Schlachtplans, der Verlierer erhält die andere.',
      '**2. Ruhm (Renown):** Jede beteiligte Einheit +W3 (vernichtet: +1). Eine Einheit (nicht der General) wird „Favoured Warriors“: +W6. Purify the Land: +2 je Erfolg.',
      '**Ränge nach Ruhm:** 5–14 Aspiring · 15–29 Elite · 30–44 Mighty · 45+ Legendary. Bei 5 Ruhm Pfad wählen; bei jedem Rang eine von zwei Fähigkeiten.',
      '**3. Roster verwalten:** Held befördern · Ausbauen: 1 neue Einheit **oder** 1 Einheit verstärken (kostet GP = Punktwert) plus ggf. 1 Landmark of Ghyran · Einheiten/Fraktionsgelände entlassen (halbe Punkte als GP zurück) · Artefakte übertragen/Verbesserungen entfernen · General wechseln (alter General W3 Kampfwunden) · Pfad wechseln (Rang −1, Ruhm auf Minimum des neuen Rangs).',
      '**Max. 5 Regimenter.** Neue Helden bei 5 Regimentern nur als Hilfseinheit.',
      '**Tränke (optional):** Zutaten sammeln (Einfach 5 GP, Exotisch 10 GP pro Wurf), Tränke mischen oder für 30 GP kaufen (gekauft: Nebenwirkungswurf beim Einsatz). Max. 1 Trank pro Held.',
    ] } : { id: 'aftermath', title: 'Aftermath: Splitter, Ränge und Ausbau', body: [
      '**1. Splitter gewinnen:** Sieg 3 · Niederlage W3 · Unentschieden W3 (einmal wiederholbar) · Hateful-Shores-Schlachtplan +W3 · +1 pro Emberstone-Marke am Schlachtende. Ruhmpunkte aus Fähigkeiten: 5 = 1 Splitter.',
      '**2. Roster verwalten:** Held befördern · Einheiten entlassen (Rückerstattung: bis 200 Pkt 1, bis 300: 2, bis 400: 3, bis 500: 4, darüber 5) · Artefakte übertragen/Verbesserungen entfernen · General wechseln (alter General W3 Kampfwunden, behält Verbesserungen) · Pfad wechseln (Rang −1, Fähigkeiten neu wählen).',
      '**3. Splitter ausgeben** (jede Aktion 1× pro Aftermath):',
      '· Pfad betreten (Aspiring) **1** · Elite **2** · Mighty **4** · Legendary **6** – Ränge nur der Reihe nach.',
      '· Verbesserung **3** · Zauber/Gebet **2** (max. 6 im Arcane Tome).',
      '· Neue Einheit (Mindestgröße) oder verstärken (nach unverstärktem Punktwert): bis 100 Pkt **2** · bis 200 **3** · bis 300 **4** · bis 400 **6** · bis 500 **8** · bis 600 **10** · darüber **15**.',
      '· Fraktionsgelände **3** · Emberstone-Waffe schmieden **2** (+1 je Zusatzwurf) · Ravaged Coast Regiment of Renown **2**.',
      '**Instabile Waffen:** Für jede Emberstone-Waffe, die nicht in diesem Aftermath geschmiedet wurde, W6 – bei 1 zerbricht sie und der Held erleidet 1 Kampfwunde.',
    ] },
    { id: 'wunden', title: 'Kampfwunden, Narben und Heilung', body: [
      ...(packId === 'bw' ? ['**Ruhende Einheiten** heilen zuerst W6 Kampfwunden.'] : []),
      '**Kampfwunden:** Jede vernichtete Einheit erleidet W3.',
      packId === 'bw' ? '**Verseuchung:** Jede Einheit, die am Schlachtende in 3" eines verseuchten Geländes stand, erleidet 1 Kampfwunde.' : '**Emberstone:** Jede Einheit, die am Ende eine Emberstone-Marke hatte, würfelt: 1–4 = 1 Kampfwunde.',
      '**Untimely Arrival:** Reserve-Einheiten, die nie aufs Feld kamen, erleiden keine Kampfwunden.',
      '**Narben:** 5–8 Wunden = ernst · 9–12 = schwer · 13–17 = kritisch · 18+ = die Einheit stirbt und wird gestrichen. Jede Stufe nur einmal pro Einheit; beim ersten Erreichen auf der Tabelle würfeln. Narben bleiben, auch wenn Wunden heilen.',
      '**Stirbt der General**, wird ein anderer Held General' + (packId === 'bw' ? ' (ohne Pfad: 5 Ruhm und kostenloser Pfad).' : ' (ohne Pfad: kostenlos Aspiring-Pfad).') + ' Ohne Helden endet deine Geschichte.',
      '**Stirbt ein Regimentsführer**, werden seine Einheiten zu Hilfseinheiten.',
      '**Heilungsritual:** Bis zu 2 Helden würfeln je einen W6: 1 = Ritual scheitert, der Held ist bis Ende der nächsten Schlacht „erschöpft“' + (packId === 'bw' ? ' (kein Purify the Land, kein Boon of Vitality)' : ' (−1 auf Zauber-, Gebets- und Trefferwürfe)') + '. 2+ = bei einer Einheit so viele Kampfwunden entfernen.',
    ] },
    { id: 'pfade', title: 'Pfade und Ränge', body: [
      packId === 'bw'
        ? 'In Blighted Wilds steigen Einheiten durch **Ruhm (Renown)** auf: 5 / 15 / 30 / 45. Erlaubt sind die Pfade aus Blighted Wilds, aus Ravaged Coast und aus eurem Battletome.'
        : 'In Ravaged Coast kaufst du Ränge mit **Splittern**: Pfad + Aspiring 1, Elite 2, Mighty 4, Legendary 6 – immer der Reihe nach, pro Aftermath einmal „Fortschritt auf einem Pfad“.',
      'Bei jedem Rang wählst du **eine von zwei** Fähigkeiten. Wechselst du den Pfad, sinkt der Rang um 1 und du wählst die Fähigkeiten des neuen Pfads neu.',
      'Einzigartige Einheiten dürfen keinen Pfad betreten. Pfade aus dem Battletome eurer Fraktion sind ebenfalls erlaubt (in der App als „eigener Pfad“ eintragbar).',
    ], paths: true },
    { id: 'sieg', title: 'Kampagnensieg', body: [
      packId === 'bw'
        ? 'Die Kampagne endet, sobald jemand einen **großen Sieg in „Be It Purity or Putrescence“** erringt. Er erhält die Blighted-Wilds-Trophäe und die Fähigkeit „Purifiers of the Blighted Wilds“ (1× pro Schlacht Heilen (3) bei jeder befreundeten Einheit).'
        : 'Die Kampagne endet, sobald jemand einen **großen Sieg in „Raid on Hel\'s Claw“** erringt. Er erhält die Emberstone-Trophäe der Ravaged Coast.',
      'Eroberte Felder sind in dieser Kampagne reine Optik – entscheidend sind Siege und das Finale.',
    ] },
  ];
  return common;
}
