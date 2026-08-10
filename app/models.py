"""Silver-Schicht plus das Gold-Read-Model.

Spaltennamen folgen den Wahapedia-CSV-Feldern, damit der ETL ohne Mapping-
Tabelle auskommt und ein Feldwechsel an der Quelle sofort sichtbar wird.
Abweichungen zum Entwurf in PLAN.md §2 sind am jeweiligen Modell vermerkt.
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Meta(Base):
    """Freie Schlüssel/Wert-Ablage: last_update, ingested_at, Zeilenzähler."""

    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class Source(Base):
    __tablename__ = "source"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(Text, default="")
    edition: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[str] = mapped_column(Text, default="")
    errata_date: Mapped[str] = mapped_column(Text, default="")
    errata_link: Mapped[str] = mapped_column(Text, default="")


class Faction(Base):
    __tablename__ = "faction"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(Text, default="")


class Datasheet(Base):
    __tablename__ = "datasheet"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    faction_id: Mapped[str] = mapped_column(String, index=True, default="")
    source_id: Mapped[str] = mapped_column(String, default="")
    legend: Mapped[str] = mapped_column(Text, default="")
    role: Mapped[str] = mapped_column(Text, default="")
    loadout: Mapped[str] = mapped_column(Text, default="")
    transport: Mapped[str] = mapped_column(Text, default="")
    virtual: Mapped[str] = mapped_column(Text, default="")
    leader_head: Mapped[str] = mapped_column(Text, default="")
    leader_footer: Mapped[str] = mapped_column(Text, default="")
    damaged_w: Mapped[str] = mapped_column(Text, default="")
    damaged_description: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(Text, default="")


class ModelProfile(Base):
    __tablename__ = "model_profile"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    line: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    M: Mapped[str] = mapped_column(Text, default="")
    T: Mapped[str] = mapped_column(Text, default="")
    Sv: Mapped[str] = mapped_column(Text, default="")
    inv_sv: Mapped[str] = mapped_column(Text, default="")
    inv_sv_descr: Mapped[str] = mapped_column(Text, default="")
    W: Mapped[str] = mapped_column(Text, default="")
    Ld: Mapped[str] = mapped_column(Text, default="")
    OC: Mapped[str] = mapped_column(Text, default="")
    base_size: Mapped[str] = mapped_column(Text, default="")
    #: Nicht im Entwurf von PLAN.md §2 — existiert im echten Export.
    base_size_descr: Mapped[str] = mapped_column(Text, default="")


class Weapon(Base):
    __tablename__ = "weapon"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    line: Mapped[str] = mapped_column(String, primary_key=True)
    #: Nicht im Entwurf von PLAN.md §2 — existiert im echten Export.
    line_in_wargear: Mapped[str] = mapped_column(String, primary_key=True, default="")
    dice: Mapped[str] = mapped_column(Text, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    range: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(Text, default="")
    A: Mapped[str] = mapped_column(Text, default="")
    BS_WS: Mapped[str] = mapped_column(Text, default="")
    S: Mapped[str] = mapped_column(Text, default="")
    AP: Mapped[str] = mapped_column(Text, default="")
    D: Mapped[str] = mapped_column(Text, default="")


class DatasheetKeyword(Base):
    __tablename__ = "datasheet_keyword"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasheet_id: Mapped[str] = mapped_column(String, index=True)
    keyword: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(Text, default="")
    is_faction_keyword: Mapped[str] = mapped_column(Text, default="")


class DatasheetAbility(Base):
    __tablename__ = "datasheet_ability"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasheet_id: Mapped[str] = mapped_column(String, index=True)
    line: Mapped[str] = mapped_column(String, default="")
    ability_id: Mapped[str] = mapped_column(String, default="")
    model: Mapped[str] = mapped_column(Text, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(Text, default="")
    parameter: Mapped[str] = mapped_column(Text, default="")


class Ability(Base):
    __tablename__ = "ability"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(Text, default="")
    legend: Mapped[str] = mapped_column(Text, default="")
    faction_id: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")


class LeaderAttach(Base):
    """PLAN.md §1.1: der wichtigste einzelne Datensatz des Projekts."""

    __tablename__ = "leader_attach"
    leader_id: Mapped[str] = mapped_column(String, primary_key=True)
    attached_id: Mapped[str] = mapped_column(String, primary_key=True)


class Enhancement(Base):
    __tablename__ = "enhancement"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    faction_id: Mapped[str] = mapped_column(String, index=True, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    cost: Mapped[str] = mapped_column(Text, default="")
    detachment: Mapped[str] = mapped_column(Text, default="")
    detachment_id: Mapped[str] = mapped_column(String, index=True, default="")
    legend: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")


class DatasheetEnhancement(Base):
    __tablename__ = "datasheet_enhancement"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    enhancement_id: Mapped[str] = mapped_column(String, primary_key=True)


class DetachmentAbility(Base):
    __tablename__ = "detachment_ability"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    faction_id: Mapped[str] = mapped_column(String, index=True, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    legend: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    detachment: Mapped[str] = mapped_column(Text, default="")
    detachment_id: Mapped[str] = mapped_column(String, index=True, default="")


class DatasheetDetachmentAbility(Base):
    __tablename__ = "datasheet_detachment_ability"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    detachment_ability_id: Mapped[str] = mapped_column(String, primary_key=True)


class UnitComposition(Base):
    __tablename__ = "unit_composition"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    line: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str] = mapped_column(Text, default="")


class DatasheetOption(Base):
    __tablename__ = "datasheet_option"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    line: Mapped[str] = mapped_column(String, primary_key=True)
    button: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")


class Points(Base):
    __tablename__ = "points"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    line: Mapped[str] = mapped_column(String, primary_key=True)
    description: Mapped[str] = mapped_column(Text, default="")
    cost: Mapped[str] = mapped_column(Text, default="")


class Stratagem(Base):
    __tablename__ = "stratagem"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    faction_id: Mapped[str] = mapped_column(String, index=True, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(Text, default="")
    cp_cost: Mapped[str] = mapped_column(Text, default="")
    legend: Mapped[str] = mapped_column(Text, default="")
    turn: Mapped[str] = mapped_column(Text, default="")
    phase: Mapped[str] = mapped_column(Text, default="")
    detachment: Mapped[str] = mapped_column(Text, default="")
    detachment_id: Mapped[str] = mapped_column(String, index=True, default="")
    description: Mapped[str] = mapped_column(Text, default="")


class DatasheetCard(Base):
    """Gold-Read-Model für den Regel-Inspektor — PLAN.md §6.4.

    Ein denormalisiertes Dokument je Datasheet, damit das Panel ohne zwölf
    Joins und ohne Netzwerkzugriff im 100-ms-Budget bleibt.
    """

    __tablename__ = "datasheet_card"
    datasheet_id: Mapped[str] = mapped_column(String, primary_key=True)
    ruleset_version: Mapped[str] = mapped_column(String, primary_key=True)
    faction_id: Mapped[str] = mapped_column(String, index=True, default="")
    name: Mapped[str] = mapped_column(Text, default="")
    role: Mapped[str] = mapped_column(Text, default="")
    min_cost: Mapped[int] = mapped_column(Integer, default=0)
    is_epic_hero: Mapped[bool] = mapped_column(Boolean, default=False)
    is_character: Mapped[bool] = mapped_column(Boolean, default=False)
    transport_capacity: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[str] = mapped_column(Text, default="{}")


Index("ix_card_faction", DatasheetCard.faction_id, DatasheetCard.ruleset_version)
Index("ix_leader_attached", LeaderAttach.attached_id)
Index("ix_ds_enh_enh", DatasheetEnhancement.enhancement_id)
