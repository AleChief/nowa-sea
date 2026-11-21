"""Species table. Everything tunable lives here (docs/species.md explains the choices)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

DAY_S = 1200.0          # one simulated day: 20 minutes
NIGHT_FRACTION = 1 / 3  # last third of the day is night


@dataclass
class Species:
    id: str
    index: int
    name_ru: str
    name_en: str
    brain: str                         # "nowa" or "simple"
    target: int
    cap: int
    length: float                      # m, for rendering
    radius: float                      # m, collision body
    cruise: float                      # m/s
    burst: float                       # m/s
    turn_rate: float                   # rad/s at cruise
    accel: float                       # m/s^2
    vision: float                      # m
    fov_deg: float
    lifespan_days: float               # base, multiplied by the NOWA lifespan gene
    mature_days: float
    sleep_window: Tuple[float, float]  # fraction of day [start, end) when it sleeps
    actions: List[str] = field(default_factory=list)
    features: List[str] = field(default_factory=list)   # sensor features (docs/species.md)
    diet: Dict[str, float] = field(default_factory=dict)  # food kind -> energy yield
    metabolism: float = 0.004          # energy per second at cruise
    burst_cost: float = 0.05           # stamina per second of burst
    breed_energy: float = 0.8
    founders: int = 4
    mesh: str = "fish"
    color: Tuple[float, float, float] = (0.6, 0.7, 0.8)
    glow: Tuple[float, float, float] = (1.0, 0.8, 0.3)
    prefers_bottom: bool = False
    max_decisions: int = 4000          # brain cost ceiling (docs/nowa-host-guide.md, section 5)
    body_content: float = 0.3          # energy a predator gains from eating one adult
    hungry_below: float = 0.85         # predators hunt only below this energy (satiety)
    breed_cooldown_days: float = 0.25
    litter: int = 1

    def describe(self) -> dict:
        return {
            "id": self.id, "index": self.index, "name": {"ru": self.name_ru, "en": self.name_en},
            "brain": self.brain, "length": self.length, "radius": self.radius, "mesh": self.mesh,
            "color": list(self.color), "glow": list(self.glow), "cruise": self.cruise, "burst": self.burst,
            "vision": self.vision, "fov_deg": self.fov_deg, "actions": list(self.actions),
            "target": self.target, "cap": self.cap,
        }


SPECIES: List[Species] = [
    Species(
        id="sparkfin", index=0, name_ru="Искорка", name_en="Sparkfin", brain="nowa", target=28, cap=40,
        length=0.35, radius=0.12, cruise=2.2, burst=6.0, turn_rate=4.0, accel=6.0, vision=12.0, fov_deg=300,
        lifespan_days=3.0, mature_days=0.6, sleep_window=(2 / 3, 1.0),
        actions=["forage", "school", "flee", "hide", "rest", "explore", "mate"],
        features=["threat", "food", "cover", "school", "energy", "stamina", "light", "edge", "mate"],
        diet={"plankton": 1.0, "pellet": 1.0}, metabolism=0.0022, breed_energy=0.7, founders=6,
        breed_cooldown_days=0.2, litter=1,
        body_content=0.30, mesh="fish", color=(0.55, 0.78, 0.80), glow=(1.0, 0.78, 0.25),
    ),
    Species(
        id="sweeper", index=1, name_ru="Скат-чистильщик", name_en="Sweeper ray", brain="nowa", target=12, cap=16,
        length=0.9, radius=0.30, cruise=1.3, burst=3.5, turn_rate=2.2, accel=3.0, vision=8.0, fov_deg=270,
        lifespan_days=4.0, mature_days=1.0, sleep_window=(0.15, 0.45),
        actions=["scavenge", "burrow", "flee", "rest", "explore", "mate"],
        features=["threat", "food", "cover", "energy", "stamina", "light", "edge", "mate"],
        diet={"detritus": 1.0, "carcass": 1.0, "pellet": 0.6}, metabolism=0.0012, breed_energy=0.7, founders=3,
        litter=2,
        body_content=0.45, mesh="manta", color=(0.62, 0.52, 0.66), glow=(0.30, 0.95, 0.90), prefers_bottom=True,
    ),
    Species(
        id="needlejaw", index=2, name_ru="Иглозуб", name_en="Needlejaw", brain="nowa", target=10, cap=14,
        length=1.5, radius=0.30, cruise=2.5, burst=8.0, turn_rate=2.6, accel=7.0, vision=16.0, fov_deg=160,
        lifespan_days=4.0, mature_days=1.0, sleep_window=(0.20, 0.50),
        actions=["ambush", "stalk", "strike", "flee", "hide", "rest", "patrol", "mate"],
        features=["threat", "prey", "cover", "energy", "stamina", "light", "edge", "mate"],
        diet={"sparkfin": 1.0}, metabolism=0.0003, burst_cost=0.12, hungry_below=0.65, breed_energy=0.75, founders=3,
        litter=2,
        body_content=0.55, mesh="needle", color=(0.12, 0.20, 0.42), glow=(0.95, 0.25, 0.85),
    ),
    Species(
        id="shade", index=3, name_ru="Тень", name_en="Shade", brain="nowa", target=4, cap=6,
        length=4.0, radius=0.85, cruise=3.0, burst=8.5, turn_rate=0.9, accel=4.0, vision=24.0, fov_deg=200,
        lifespan_days=5.0, mature_days=1.5, sleep_window=(0.0, 0.12),
        actions=["patrol", "chase", "strike", "rest", "explore", "mate"],
        features=["prey", "energy", "stamina", "light", "edge", "mate"],
        diet={"needlejaw": 1.0, "sweeper": 0.35, "sparkfin": 0.2}, metabolism=0.00025, burst_cost=0.15,
        hungry_below=0.6,
        breed_energy=0.7, founders=2, litter=2,
        body_content=0.8, mesh="shark", color=(0.22, 0.27, 0.32), glow=(0.35, 0.70, 1.00),
    ),
    Species(
        id="lumen", index=4, name_ru="Медуза-люмен", name_en="Lumen jelly", brain="simple", target=6, cap=8,
        length=0.6, radius=0.30, cruise=0.4, burst=0.6, turn_rate=0.6, accel=0.5, vision=0.0, fov_deg=0,
        lifespan_days=3.0, mature_days=0.5, sleep_window=(0.0, 0.0),
        actions=["drift"], diet={"plankton": 0.6}, metabolism=0.0010, breed_energy=0.9, founders=3,
        mesh="jelly", color=(0.85, 0.55, 0.85), glow=(0.55, 0.85, 1.00),
    ),
]

BY_ID: Dict[str, Species] = {s.id: s for s in SPECIES}
PREDATORS_OF: Dict[str, List[str]] = {
    s.id: [p.id for p in SPECIES if s.id in p.diet] for s in SPECIES
}
PREY_OF: Dict[str, List[str]] = {s.id: [k for k in s.diet if k in BY_ID] for s in SPECIES}
