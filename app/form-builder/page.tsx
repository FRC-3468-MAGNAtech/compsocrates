"use client";

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type FieldType = "number" | "checkbox" | "text" | "select" | "rating" | "slider";

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  section: string;
  options?: string[];
  scaleLabels?: string[];
  required: boolean;
}

const REEFSCAPE_MATCH_PRESET_FIELDS: FormField[] = [
  { id: "scoutName", label: "Scout Name", type: "text", section: "Pre-Match", required: true },
  { id: "team", label: "Team Number", type: "number", section: "Pre-Match", required: true },
  { id: "startingPosition", label: "Starting Position", type: "select", section: "Pre-Match", options: ["Not There", "Processor Side", "Middle", "Opposite Side"], required: true },
  { id: "leftStartingZone", label: "Left Starting Zone", type: "checkbox", section: "Autonomous", required: false },
  { id: "autoCoralMissed", label: "Auto Coral Missed", type: "number", section: "Autonomous", required: false },
  { id: "autoCoralL1", label: "Auto Coral L1", type: "number", section: "Autonomous", required: false },
  { id: "autoCoralL2", label: "Auto Coral L2", type: "number", section: "Autonomous", required: false },
  { id: "autoCoralL3", label: "Auto Coral L3", type: "number", section: "Autonomous", required: false },
  { id: "autoCoralL4", label: "Auto Coral L4", type: "number", section: "Autonomous", required: false },
  { id: "autoAlgaeProcessorMissed", label: "Auto Algae Processor Missed", type: "number", section: "Autonomous", required: false },
  { id: "autoAlgaeProcessorScored", label: "Auto Algae Processor Scored", type: "number", section: "Autonomous", required: false },
  { id: "autoAlgaeNetMissed", label: "Auto Algae Net Missed", type: "number", section: "Autonomous", required: false },
  { id: "autoAlgaeNetScored", label: "Auto Algae Net Scored", type: "number", section: "Autonomous", required: false },
  { id: "teleopCoralMissed", label: "Teleop Coral Missed", type: "number", section: "Teleop", required: false },
  { id: "teleopCoralL1", label: "Teleop Coral L1", type: "number", section: "Teleop", required: false },
  { id: "teleopCoralL2", label: "Teleop Coral L2", type: "number", section: "Teleop", required: false },
  { id: "teleopCoralL3", label: "Teleop Coral L3", type: "number", section: "Teleop", required: false },
  { id: "teleopCoralL4", label: "Teleop Coral L4", type: "number", section: "Teleop", required: false },
  { id: "teleopAlgaeRemoved", label: "Removed Algae from Reef", type: "checkbox", section: "Teleop", required: false },
  { id: "teleopProcessorMissed", label: "Teleop Processor Missed", type: "number", section: "Teleop", required: false },
  { id: "teleopProcessorScored", label: "Teleop Processor Scored", type: "number", section: "Teleop", required: false },
  { id: "teleopNetRobotMissed", label: "Teleop Net (Robot) Missed", type: "number", section: "Teleop", required: false },
  { id: "teleopNetRobotScored", label: "Teleop Net (Robot) Scored", type: "number", section: "Teleop", required: false },
  { id: "teleopNetHumanMissed", label: "Teleop Net (Human) Missed", type: "number", section: "Teleop", required: false },
  { id: "teleopNetHumanScored", label: "Teleop Net (Human) Scored", type: "number", section: "Teleop", required: false },
  { id: "failedClimb", label: "Failed Climb", type: "number", section: "Endgame", required: false },
  { id: "stageStatus", label: "End Place", type: "select", section: "Endgame", options: ["Not Parked", "Parked in Barge Zone", "Shallow Cage", "Deep Cage"], required: false },
  { id: "incidents", label: "Miscellaneous", type: "text", section: "Post-Match", required: false },
  { id: "notes", label: "Comments", type: "text", section: "Post-Match", required: false },
];

const REEFSCAPE_PIT_PRESET_FIELDS: FormField[] = [
  { id: "scoutName", label: "Scout Name", type: "text", section: "Information", required: true },
  { id: "teamNumber", label: "Team Number", type: "number", section: "Information", required: true },
  { id: "robotPictureUrl", label: "Picture of Robot", type: "text", section: "Information", required: false },
  { id: "pitDisposition", label: "Pit Disposition", type: "checkbox", section: "Disposition", required: false },
  { id: "driveDisposition", label: "Drive Disposition", type: "checkbox", section: "Disposition", required: false },
  { id: "driveBaseType", label: "Drive Base Type", type: "select", section: "Robot", options: ["Swerve L1", "Swerve L2", "Swerve L3", "Tank", "Mecanum"], required: false },
  { id: "centerOfGravity", label: "Center of Gravity", type: "select", section: "Robot", options: ["Low", "Center", "High"], required: false },
  { id: "collectCoralStation", label: "Can receive coral from the station", type: "checkbox", section: "Coral", required: false },
  { id: "collectCoralGround", label: "Can pick up coral from the ground", type: "checkbox", section: "Coral", required: false },
  { id: "collectAlgaeReef", label: "Can collect algae from reef", type: "checkbox", section: "Algae", required: false },
  { id: "collectAlgaeGround", label: "Can pick up algae from ground", type: "checkbox", section: "Algae", required: false },
  { id: "bargeCapability", label: "Barge Capability", type: "select", section: "Auto / Endgame", options: ["Can climb shallow cage", "Can climb deep cage"], required: false },
  { id: "autoCapabilities", label: "Auto Capabilities", type: "text", section: "Auto / Endgame", required: false },
  { id: "rating", label: "Overall Robot Rating", type: "slider", section: "Auto / Endgame", scaleLabels: ["Poor", "Limited", "Average", "Strong", "Elite"], required: false },
  { id: "notes", label: "Notes", type: "text", section: "Auto / Endgame", required: false },
];

function normalizeSectionForType(section: string, type: "match" | "pit"): string {
  if (type === "match") return section;
  if (section === "Information" || section === "Disposition" || section === "Robot" || section === "Coral" || section === "Algae" || section === "Auto / Endgame") {
    return section;
  }
  if (section === "Pre-Match") return "Information";
  if (section === "Autonomous" || section === "Endgame" || section === "Post-Match") return "Auto / Endgame";
  return "Robot";
}

function FormBuilderContent() {
  const { userData } = useAuth();
  const [formName, setFormName] = useState("Reefscape 2025 Scouting Form");
  const [formType, setFormType] = useState<"match" | "pit">("match");
  const [formGame, setFormGame] = useState<"REEFSCAPE" | "REBUILT">("REEFSCAPE");
  const [fields, setFields] = useState<FormField[]>([
    { id: "match", label: "Match Number", type: "number", section: "Pre-Match", required: true },
    { id: "team", label: "Team Number", type: "number", section: "Pre-Match", required: true },
  ]);
  const [activeSection, setActiveSection] = useState("Pre-Match");
  const [showAddField, setShowAddField] = useState(false);
  const [cloudForms, setCloudForms] = useState<Array<{ id: string; name: string; fields: FormField[]; formType?: "match" | "pit"; game?: "REEFSCAPE" | "REBUILT" }>>([]);
  const [selectedCloudFormId, setSelectedCloudFormId] = useState("");
  const [savedFormsModalOpen, setSavedFormsModalOpen] = useState(false);
  const [presetsModalOpen, setPresetsModalOpen] = useState(false);
  
  const [newField, setNewField] = useState<FormField>({
    id: "",
    label: "",
    type: "number",
    section: "Pre-Match",
    options: [],
    scaleLabels: ["", "", "", "", ""],
    required: false,
  });

  const matchSections = ["Pre-Match", "Autonomous", "Teleop", "Endgame", "Post-Match"];
  const pitSections = ["Information", "Disposition", "Robot", "Coral", "Algae", "Auto / Endgame"];
  const sections = formType === "pit" ? pitSections : matchSections;

  useEffect(() => {
    async function loadCloudForms() {
      await refreshCloudForms();
    }
    void loadCloudForms();
  }, [userData?.teamId]);

  useEffect(() => {
    if (!sections.includes(activeSection)) {
      setActiveSection(sections[0]);
    }
  }, [activeSection, sections]);

  function addField() {
    if (!newField.label) return;
    
    const id = newField.label.toLowerCase().replace(/\s+/g, "_");
    setFields([...fields, { ...newField, id }]);
    setNewField({
      id: "",
      label: "",
      type: "number",
      section: activeSection,
      options: [],
      scaleLabels: ["", "", "", "", ""],
      required: false,
    });
    setShowAddField(false);
  }

  function removeField(id: string) {
    setFields(fields.filter(f => f.id !== id));
  }

  function duplicateField(field: FormField) {
    const newId = `${field.id}_copy_${Date.now()}`;
    setFields([...fields, { ...field, id: newId, label: `${field.label} (Copy)` }]);
  }

  function moveField(id: string, direction: "up" | "down") {
    const index = fields.findIndex(f => f.id === id);
    if (index === -1) return;
    
    const newFields = [...fields];
    const [removed] = newFields.splice(index, 1);
    newFields.splice(direction === "up" ? index - 1 : index + 1, 0, removed);
    setFields(newFields);
  }

  function exportForm() {
    const formData = {
      name: formName,
      formType,
      game: formGame,
      fields,
      createdAt: Date.now(),
    };
    
    const blob = new Blob([JSON.stringify(formData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formName.toLowerCase().replace(/\s+/g, "-")}.json`;
    a.click();
  }

  async function refreshCloudForms() {
    if (!userData?.teamId) return;
    const cloudQuery = query(collection(db, "formPresets"), where("teamId", "==", userData.teamId));
    const snapshot = await getDocs(cloudQuery);
    setCloudForms(snapshot.docs.map((presetDoc) => ({
      id: presetDoc.id,
      ...(presetDoc.data() as { name: string; fields: FormField[]; formType?: "match" | "pit"; game?: "REEFSCAPE" | "REBUILT" }),
    })));
  }

  async function updateSelectedSavedForm() {
    if (!userData?.teamId || !selectedCloudFormId) return;
    await setDoc(
      doc(db, "formPresets", selectedCloudFormId),
      {
        teamId: userData.teamId,
        name: formName,
        fields,
        formType,
        game: formGame,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    const selectedName = formName;
    setCloudForms((prev) =>
      prev.map((item) =>
        item.id === selectedCloudFormId ? { ...item, name: selectedName, fields, formType, game: formGame } : item
      )
    );
    alert("Saved form updated.");
    await refreshCloudForms();
  }

  async function deleteSelectedSavedForm() {
    if (!selectedCloudFormId) return;
    if (!confirm("Delete this saved form?")) return;
    await deleteDoc(doc(db, "formPresets", selectedCloudFormId));
    setSelectedCloudFormId("");
    await refreshCloudForms();
    alert("Saved form deleted.");
  }

  function loadCloudPreset(presetId: string) {
    setSelectedCloudFormId(presetId);
    const preset = cloudForms.find((item) => item.id === presetId);
    if (!preset) return;
    const targetType = preset.formType || "match";
    setFormType(targetType);
    setFormName(preset.name);
    setFields(preset.fields.map((field) => ({ ...field, section: normalizeSectionForType(field.section, targetType) })));
    setFormGame(preset.game || "REEFSCAPE");
    setActiveSection(targetType === "pit" ? "Information" : "Pre-Match");
  }

  async function setAsActiveAppliedForm() {
    if (!userData?.teamId || !selectedCloudFormId) return;
    const selected = cloudForms.find((preset) => preset.id === selectedCloudFormId);
    const selectedType = selected?.formType || formType;
    const selectedGame = selected?.game || formGame;
    if (selectedGame === "REBUILT") {
      alert("Assigning REBUILT forms is disabled for now.");
      return;
    }
    await setDoc(
      doc(db, "teams", userData.teamId),
      selectedType === "pit"
        ? { activePitFormPresetId: selectedCloudFormId, activePitGame: selectedGame }
        : { activeMatchFormPresetId: selectedCloudFormId, activeMatchGame: selectedGame },
      { merge: true }
    );
    if (selectedType === "match") {
      localStorage.setItem("analytics-selected-game", selectedGame);
    }
    alert(`Active ${selectedType} form preset updated (${selectedGame}).`);
  }

  function importForm(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const imported = JSON.parse(content);
        
        if (imported.name && Array.isArray(imported.fields)) {
          setFormName(imported.name);
          if (imported.formType === "match" || imported.formType === "pit") {
            setFormType(imported.formType);
          }
          if (imported.game === "REEFSCAPE" || imported.game === "REBUILT") {
            setFormGame(imported.game);
          }
          const targetType = imported.formType === "pit" ? "pit" : "match";
          setFields(imported.fields.map((field: FormField) => ({ ...field, section: normalizeSectionForType(field.section, targetType) })));
          setActiveSection(targetType === "pit" ? "Information" : "Pre-Match");
          alert("Form imported successfully!");
        } else {
          alert("Invalid form file format");
        }
      } catch (error) {
        alert("Error importing form: " + (error as Error).message);
      }
    };
    reader.readAsText(file);
  }

  function loadBuiltInPreset(name: string, presetFields: FormField[]) {
    setFormName(name);
    setFields(presetFields);
    setFormGame("REEFSCAPE");
    const targetType = name.toLowerCase().includes("pit") ? "pit" : "match";
    setFormType(targetType);
    setActiveSection(targetType === "pit" ? "Information" : "Pre-Match");
    setShowAddField(false);
  }

  function openPresetsModal() {
    setPresetsModalOpen(true);
  }

  function openSavedFormsModal() {
    setSavedFormsModalOpen(true);
  }

  const fieldsBySection = sections.reduce((acc, section) => {
    acc[section] = fields.filter(f => f.section === section);
    return acc;
  }, {} as Record<string, FormField[]>);

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold mb-2" style={{ color: "var(--primary-color)" }}>
                Form Builder
              </h1>
              <p className="text-gray-600">
                Create and customize your scouting forms for each season
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={openPresetsModal}
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ background: "var(--primary-gradient)" }}
              >
                Presets
              </button>
              <button
                onClick={openSavedFormsModal}
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: "#374151" }}
              >
                Saved Forms
              </button>
              <label
                className="px-4 py-2 rounded-lg text-white font-medium cursor-pointer"
                style={{ backgroundColor: "#666" }}
              >
                Import Form
                <input
                  type="file"
                  accept=".json"
                  onChange={importForm}
                  className="hidden"
                />
              </label>
              <button
                onClick={exportForm}
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                Export Form
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* LEFT: Form Builder */}
            <div className="lg:col-span-2 space-y-6">
              {/* FORM NAME */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Form Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full border rounded-lg p-3 text-lg font-semibold"
                  style={{ borderColor: "var(--primary-color)" }}
                />
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Form Type</label>
                    <select
                      value={formType}
                      onChange={(event) => setFormType(event.target.value as "match" | "pit")}
                      className="w-full border rounded-lg p-2"
                    >
                      <option value="match">Match</option>
                      <option value="pit">Pit</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Game</label>
                    <select
                      value={formGame}
                      onChange={(event) => setFormGame(event.target.value as "REEFSCAPE" | "REBUILT")}
                      className="w-full border rounded-lg p-2"
                    >
                      <option value="REEFSCAPE">REEFSCAPE</option>
                      <option value="REBUILT">REBUILT</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTIONS */}
              {sections.map((section) => (
                <div key={section} className="bg-white rounded-xl shadow-md overflow-hidden">
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer"
                    style={{ backgroundColor: activeSection === section ? "var(--primary-color)" : "#f9fafb" }}
                    onClick={() => setActiveSection(section)}
                  >
                    <h2 className={`text-xl font-semibold ${activeSection === section ? "text-white" : "text-gray-900"}`}>
                      {section}
                    </h2>
                    <span className={`px-3 py-1 rounded-full text-sm ${activeSection === section ? "bg-white text-red-600" : "bg-gray-200"}`}>
                      {fieldsBySection[section].length} fields
                    </span>
                  </div>

                  {activeSection === section && (
                    <div className="p-6 space-y-4">
                      {fieldsBySection[section].length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No fields in this section yet</p>
                      ) : (
                        fieldsBySection[section].map((field, index) => (
                          <div
                            key={field.id}
                            className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border-2 border-transparent hover:border-red-200 transition-colors"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold">{field.label}</h3>
                                {field.required && (
                                  <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded">Required</span>
                                )}
                              </div>
                              <p className="text-sm text-gray-600">
                                Type: <span className="font-mono">{field.type}</span>
                                {field.options && field.options.length > 0 && (
                                  <> • Options: {field.options.join(", ")}</>
                                )}
                                {field.scaleLabels && field.scaleLabels.some((label) => label.trim().length > 0) && (
                                  <> • Scale: {field.scaleLabels.map((label, i) => `${i + 1}=${label || "-"}`).join(", ")}</>
                                )}
                              </p>
                            </div>
                            
                            <div className="flex gap-1">
                              {index > 0 && (
                                <button
                                  onClick={() => moveField(field.id, "up")}
                                  className="p-1.5 rounded hover:bg-gray-200"
                                  title="Move up"
                                >
                                  ↑
                                </button>
                              )}
                              {index < fieldsBySection[section].length - 1 && (
                                <button
                                  onClick={() => moveField(field.id, "down")}
                                  className="p-1.5 rounded hover:bg-gray-200"
                                  title="Move down"
                                >
                                  ↓
                                </button>
                              )}
                              <button
                                onClick={() => duplicateField(field)}
                                className="p-1.5 rounded hover:bg-blue-100 text-blue-600"
                                title="Duplicate"
                              >
                                📋
                              </button>
                              <button
                                onClick={() => removeField(field.id)}
                                className="p-1.5 rounded hover:bg-red-100 text-red-600"
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      )}

                      <button
                        onClick={() => {
                          setShowAddField(true);
                          setNewField({ ...newField, section });
                        }}
                        className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-red-400 hover:bg-red-50 text-gray-600 hover:text-red-600 font-medium transition-colors"
                      >
                        + Add Field to {section}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* RIGHT: Add Field Panel */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-md p-6 sticky top-8">
                <h2 className="text-xl font-semibold mb-4">
                  {showAddField ? "Add New Field" : "Field Properties"}
                </h2>

                {showAddField ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Field Label
                      </label>
                      <input
                        type="text"
                        value={newField.label}
                        onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                        placeholder="e.g., Auto Coral L1"
                        className="w-full border rounded-lg p-2"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Field Type
                      </label>
                      <select
                        value={newField.type}
                        onChange={(e) => {
                          const type = e.target.value as FieldType;
                          setNewField({
                            ...newField,
                            type,
                            scaleLabels: type === "slider" || type === "rating"
                              ? (newField.scaleLabels && newField.scaleLabels.length === 5 ? newField.scaleLabels : ["", "", "", "", ""])
                              : newField.scaleLabels,
                          });
                        }}
                        className="w-full border rounded-lg p-2"
                      >
                        <option value="number">Number Counter</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="text">Text Input</option>
                        <option value="select">Dropdown</option>
                        <option value="slider">Slider (1-5)</option>
                        <option value="rating">Rating (Legacy 1-5)</option>
                      </select>
                    </div>

                    {newField.type === "select" && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Options (comma-separated)
                        </label>
                        <input
                          type="text"
                          placeholder="Option 1, Option 2, Option 3"
                          onChange={(e) => setNewField({ 
                            ...newField, 
                            options: e.target.value.split(",").map(s => s.trim())
                          })}
                          className="w-full border rounded-lg p-2"
                        />
                      </div>
                    )}

                    {(newField.type === "slider" || newField.type === "rating") && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Slider Meanings (1 to 5)
                        </label>
                        <div className="space-y-2">
                          {[1, 2, 3, 4, 5].map((value, index) => (
                            <input
                              key={value}
                              type="text"
                              value={newField.scaleLabels?.[index] || ""}
                              onChange={(event) => {
                                const next = [...(newField.scaleLabels || ["", "", "", "", ""])];
                                next[index] = event.target.value;
                                setNewField({ ...newField, scaleLabels: next });
                              }}
                              placeholder={`What does ${value} mean?`}
                              className="w-full border rounded-lg p-2"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Section
                      </label>
                      <select
                        value={newField.section}
                        onChange={(e) => setNewField({ ...newField, section: e.target.value })}
                        className="w-full border rounded-lg p-2"
                      >
                        {sections.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={newField.required}
                        onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                        className="rounded"
                      />
                      <label className="text-sm font-medium text-gray-700">
                        Required Field
                      </label>
                    </div>

                    <div className="flex gap-2 pt-4 border-t">
                      <button
                        onClick={addField}
                        disabled={!newField.label}
                        className="flex-1 py-2 rounded-lg text-white font-medium disabled:bg-gray-300"
                        style={{ backgroundColor: newField.label ? "var(--primary-color)" : undefined }}
                      >
                        Add Field
                      </button>
                      <button
                        onClick={() => setShowAddField(false)}
                        className="flex-1 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-4">📝</div>
                    <p className="text-gray-600 mb-4">
                      Click &quot;+ Add Field&quot; to create a new field, or click on an existing field to edit it.
                    </p>
                    <div className="space-y-2 text-sm text-left bg-gray-50 p-4 rounded-lg">
                      <p className="font-semibold">Field Types:</p>
                      <ul className="space-y-1 text-gray-600">
                        <li>• <strong>Number:</strong> For counting game pieces</li>
                        <li>• <strong>Checkbox:</strong> For yes/no questions</li>
                        <li>• <strong>Text:</strong> For notes and comments</li>
                        <li>• <strong>Dropdown:</strong> For predefined choices</li>
                        <li>• <strong>Slider:</strong> For 1-5 scale with custom meanings</li>
                        <li>• <strong>Rating:</strong> Legacy 1-5 scale</li>
                      </ul>
                    </div>
                  </div>
                )}

                {/* SUMMARY */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="font-semibold mb-2">Form Summary</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Total Fields: <strong>{fields.length}</strong></p>
                    <p>Required Fields: <strong>{fields.filter(f => f.required).length}</strong></p>
                    <p>Sections: <strong>{sections.length}</strong></p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {presetsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>Presets</h2>
              <button onClick={() => setPresetsModalOpen(false)} className="px-3 py-1 border rounded">Close</button>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => {
                  loadBuiltInPreset("3468 REEFSCAPE Match Scout Form", REEFSCAPE_MATCH_PRESET_FIELDS);
                  setPresetsModalOpen(false);
                }}
                className="w-full py-3 rounded text-white font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                3468 REEFSCAPE Match Scout Form
              </button>
              <button
                onClick={() => {
                  loadBuiltInPreset("3468 REEFSCAPE Pit Scout Form", REEFSCAPE_PIT_PRESET_FIELDS);
                  setPresetsModalOpen(false);
                }}
                className="w-full py-3 rounded text-white font-medium"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                3468 REEFSCAPE Pit Scout Form
              </button>
            </div>
          </div>
        </div>
      )}

      {savedFormsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>Saved Forms</h2>
              <button onClick={() => setSavedFormsModalOpen(false)} className="px-3 py-1 border rounded">Close</button>
            </div>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {cloudForms.length === 0 ? (
                <p className="text-sm text-gray-500">No saved forms yet.</p>
              ) : (
                cloudForms.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      loadCloudPreset(preset.id);
                    }}
                    className={`w-full text-left px-4 py-3 rounded border ${
                      selectedCloudFormId === preset.id ? "border-red-400 bg-red-50" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <p className="font-medium">{preset.name}</p>
                    <p className="text-xs text-gray-600">{preset.formType || "match"} • {preset.game || "REEFSCAPE"}</p>
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 grid md:grid-cols-3 gap-2">
              <button
                onClick={updateSelectedSavedForm}
                disabled={!selectedCloudFormId}
                className="py-2 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: "#1f7a3d" }}
              >
                Update Selected
              </button>
              <button
                onClick={deleteSelectedSavedForm}
                disabled={!selectedCloudFormId}
                className="py-2 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: "#b42318" }}
              >
                Delete Selected
              </button>
              <button
                onClick={setAsActiveAppliedForm}
                disabled={!selectedCloudFormId}
                className="py-2 rounded text-white disabled:opacity-50"
                style={{ background: "var(--primary-gradient)" }}
              >
                Set Active Form
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FormBuilderPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
            <div className="bg-white rounded-xl shadow-md p-8 border-l-4" style={{ borderColor: "var(--primary-color)" }}>
              <h1 className="text-3xl font-bold mb-3" style={{ color: "var(--primary-color)" }}>
                Form Builder
              </h1>
              <p className="text-gray-700">
                This page is not ready yet and is temporarily blocked.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}


