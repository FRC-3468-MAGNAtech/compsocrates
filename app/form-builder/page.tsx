"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import ProtectedRoute from "@/app/components/ProtectedRoute";
import Sidebar from "@/app/components/Sidebar";
import { useAuth } from "@/app/AuthContext";
import { db } from "@/app/firebase";

type FieldType = "number" | "checkbox" | "text" | "select" | "rating";

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  section: string;
  options?: string[];
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

function FormBuilderContent() {
  const { userData } = useAuth();
  const [formName, setFormName] = useState("Reefscape 2025 Scouting Form");
  const [fields, setFields] = useState<FormField[]>([
    { id: "match", label: "Match Number", type: "number", section: "Pre-Match", required: true },
    { id: "team", label: "Team Number", type: "number", section: "Pre-Match", required: true },
  ]);
  const [activeSection, setActiveSection] = useState("Pre-Match");
  const [showAddField, setShowAddField] = useState(false);
  const [cloudForms, setCloudForms] = useState<Array<{ id: string; name: string; fields: FormField[] }>>([]);
  const [selectedCloudFormId, setSelectedCloudFormId] = useState("");
  const [savingCloud, setSavingCloud] = useState(false);
  
  const [newField, setNewField] = useState<FormField>({
    id: "",
    label: "",
    type: "number",
    section: "Pre-Match",
    options: [],
    required: false,
  });

  const sections = ["Pre-Match", "Autonomous", "Teleop", "Endgame", "Post-Match"];

  useEffect(() => {
    async function loadCloudForms() {
      if (!userData?.teamId) return;
      const cloudQuery = query(collection(db, "formPresets"), where("teamId", "==", userData.teamId));
      const snapshot = await getDocs(cloudQuery);
      setCloudForms(snapshot.docs.map((presetDoc) => ({
        id: presetDoc.id,
        ...(presetDoc.data() as { name: string; fields: FormField[] }),
      })));
    }
    loadCloudForms();
  }, [userData?.teamId]);

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

  async function savePresetToCloud() {
    if (!userData?.teamId || !userData.uid) return;
    setSavingCloud(true);
    try {
      await addDoc(collection(db, "formPresets"), {
        teamId: userData.teamId,
        name: formName,
        fields,
        formType: "match",
        createdBy: userData.uid,
        createdAt: Date.now(),
      });
      alert("Preset saved to cloud.");
      const cloudQuery = query(collection(db, "formPresets"), where("teamId", "==", userData.teamId));
      const snapshot = await getDocs(cloudQuery);
      setCloudForms(snapshot.docs.map((presetDoc) => ({
        id: presetDoc.id,
        ...(presetDoc.data() as { name: string; fields: FormField[] }),
      })));
    } finally {
      setSavingCloud(false);
    }
  }

  function loadCloudPreset(presetId: string) {
    setSelectedCloudFormId(presetId);
    const preset = cloudForms.find((item) => item.id === presetId);
    if (!preset) return;
    setFormName(preset.name);
    setFields(preset.fields);
  }

  async function setAsActiveMatchForm() {
    if (!userData?.teamId || !selectedCloudFormId) return;
    await setDoc(
      doc(db, "teams", userData.teamId),
      { activeMatchFormPresetId: selectedCloudFormId },
      { merge: true }
    );
    alert("Active match form preset updated.");
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
          setFields(imported.fields);
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

  function loadBuiltInReefscapePreset() {
    setFormName("3468 REEFSCAPE Match Scout Form");
    setFields(REEFSCAPE_MATCH_PRESET_FIELDS);
    setActiveSection("Pre-Match");
    setShowAddField(false);
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
              <h1 className="text-3xl font-bold mb-2" style={{ color: "#c42221" }}>
                Form Builder
              </h1>
              <p className="text-gray-600">
                Create and customize your scouting forms for each season
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={loadBuiltInReefscapePreset}
                className="px-4 py-2 rounded-lg text-white font-medium"
                style={{ background: "var(--primary-gradient)" }}
              >
                Load 3468 REEFSCAPE Preset
              </button>
              <button
                onClick={savePresetToCloud}
                disabled={savingCloud}
                className="px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50"
                style={{ backgroundColor: "var(--primary-color)" }}
              >
                {savingCloud ? "Saving..." : "Save To Cloud"}
              </button>
              <label
                className="px-4 py-2 rounded-lg text-white font-medium cursor-pointer"
                style={{ backgroundColor: "#666" }}
              >
                📥 Import Form
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
                style={{ backgroundColor: "#c42221" }}
              >
                💾 Export Form
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
                  style={{ borderColor: "#c42221" }}
                />
              </div>

              {/* SECTIONS */}
              {sections.map((section) => (
                <div key={section} className="bg-white rounded-xl shadow-md overflow-hidden">
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer"
                    style={{ backgroundColor: activeSection === section ? "#c42221" : "#f9fafb" }}
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
                        onChange={(e) => setNewField({ ...newField, type: e.target.value as FieldType })}
                        className="w-full border rounded-lg p-2"
                      >
                        <option value="number">Number Counter</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="text">Text Input</option>
                        <option value="select">Dropdown</option>
                        <option value="rating">Rating (1-5)</option>
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
                        style={{ backgroundColor: newField.label ? "#c42221" : undefined }}
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
                        <li>• <strong>Rating:</strong> For 1-5 scale assessments</li>
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
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Cloud Presets</label>
                    <select
                      value={selectedCloudFormId}
                      onChange={(event) => loadCloudPreset(event.target.value)}
                      className="w-full border rounded p-2"
                    >
                      <option value="">Select cloud preset</option>
                      {cloudForms.map((preset) => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={setAsActiveMatchForm}
                      disabled={!selectedCloudFormId}
                      className="w-full py-2 rounded text-white disabled:opacity-50"
                      style={{ background: "var(--primary-gradient)" }}
                    >
                      Set As Active Match Form
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FormBuilderPage() {
  return (
    <ProtectedRoute requireAuth={true} allowedRoles={["coach"]}>
      <FormBuilderContent />
    </ProtectedRoute>
  );
}

