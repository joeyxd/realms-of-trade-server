#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonReader.h"

// Scope of one probed Niagara system, read from a systems/<name>.json spec.
// The spec is the only place that names a system; nothing here is hardcoded
// except the pilot scope kept for the older capture scripts.
struct FST01cScope
{
    FString SystemObjectPath;
    FString SourceSha256;
    bool bHandlesListed = false;
    TArray<FString> Handles;
    int32 SeedBase = 0;
    // -1 means the spec gave null: record whatever the system has.
    int32 ExpectedScripts = -1;
    // /Niagara/Enums names whose entries the compiled probe records, in order.
    TArray<FString> SourceEnums;
    // Object paths (Package.Name) of the capture.textures the capture forces resident.
    // Empty when the spec has no capture block; the capture script validates the rest of it.
    TArray<FString> CaptureTextures;
};

namespace ST01cSpec
{
    inline TArray<FString> DefaultEnums()
    {
        return { TEXT("ENiagaraSUbUVAnimationMode"), TEXT("ENiagaraEmitterLifeCycleMode"), TEXT("ENiagara_EmitterStateOptions"),
                 TEXT("ENiagara_InfiniteLoopDuration"), TEXT("ENiagaraEmitterScalabilityMode_Limited"), TEXT("ENiagaraScaleColorMode") };
    }

    inline FST01cScope Pilot()
    {
        FST01cScope Scope;
        Scope.SystemObjectPath = TEXT("/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single.NS_Flame_Single");
        Scope.SourceSha256 = TEXT("985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165");
        Scope.bHandlesListed = true;
        Scope.Handles = { TEXT("NE_Flame_Basic_001"), TEXT("NE_Smoke_Basic") };
        Scope.SeedBase = 6371;
        Scope.ExpectedScripts = 10;
        Scope.SourceEnums = DefaultEnums();
        const FString TextureRoot = TEXT("/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/");
        Scope.CaptureTextures = { TextureRoot + TEXT("T_FlameUV_2.T_FlameUV_2"), TextureRoot + TEXT("T_Smoke_1.T_Smoke_1") };
        return Scope;
    }

    // Reads a key that must be present and be an array or null. Array stays nullptr for null.
    inline bool ReadNullableStringArray(const FJsonObject& Root, const TCHAR* Key, const TArray<TSharedPtr<FJsonValue>>*& OutArray, FString& Error)
    {
        OutArray = nullptr;
        const TSharedPtr<FJsonValue> Value = Root.TryGetField(Key);
        if (!Value.IsValid())
        {
            Error = FString::Printf(TEXT("spec %s is required (an array of non-empty strings or null)"), Key);
            return false;
        }
        if (Value->IsNull()) return true;
        if (Value->Type != EJson::Array || !Value->TryGetArray(OutArray))
        {
            OutArray = nullptr;
            Error = FString::Printf(TEXT("spec %s must be an array of non-empty strings or null"), Key);
            return false;
        }
        return true;
    }

    inline bool CollectStrings(const TArray<TSharedPtr<FJsonValue>>& Values, const TCHAR* Key, TArray<FString>& Out, FString& Error)
    {
        for (const TSharedPtr<FJsonValue>& Value : Values)
        {
            FString Name;
            if (!Value.IsValid() || Value->Type != EJson::String || !Value->TryGetString(Name) || Name.IsEmpty())
            {
                Error = FString::Printf(TEXT("spec %s must be an array of non-empty strings or null"), Key);
                return false;
            }
            Out.Add(Name);
        }
        return true;
    }

    // Parses the spec JSON text. Returns false and fills Error when a required field is missing.
    inline bool Parse(const FString& SpecJson, FST01cScope& Out, FString& Error)
    {
        TSharedPtr<FJsonObject> Root;
        if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(SpecJson), Root) || !Root.IsValid())
        {
            Error = TEXT("spec is not valid JSON");
            return false;
        }
        FString Schema;
        if (!Root->TryGetStringField(TEXT("schema"), Schema) || Schema != TEXT("st01c-system-spec/v1"))
        {
            Error = TEXT("spec schema must be st01c-system-spec/v1");
            return false;
        }
        FString Package;
        if (!Root->TryGetStringField(TEXT("systemPackage"), Package) || !Package.StartsWith(TEXT("/Game/")))
        {
            Error = TEXT("spec systemPackage must be a /Game package path");
            return false;
        }
        int32 Slash = INDEX_NONE;
        Package.FindLastChar(TEXT('/'), Slash);
        Out.SystemObjectPath = Package + TEXT(".") + Package.Mid(Slash + 1);
        if (!Root->TryGetStringField(TEXT("sourceSystemSha256"), Out.SourceSha256) || Out.SourceSha256.Len() != 64)
        {
            Error = TEXT("spec sourceSystemSha256 must be 64 hex characters");
            return false;
        }
        // Optional-by-null keys: the key must be present; null turns the check off,
        // anything else must have the right type. A missing or mistyped key is a spec error.
        const TArray<TSharedPtr<FJsonValue>>* HandleValues = nullptr;
        if (!ReadNullableStringArray(*Root, TEXT("emitterHandles"), HandleValues, Error)) return false;
        Out.bHandlesListed = HandleValues != nullptr;
        Out.Handles.Reset();
        if (Out.bHandlesListed)
        {
            if (!CollectStrings(*HandleValues, TEXT("emitterHandles"), Out.Handles, Error)) return false;
        }
        if (!Root->TryGetNumberField(TEXT("fixtureSeedBase"), Out.SeedBase))
        {
            Error = TEXT("spec fixtureSeedBase is required");
            return false;
        }
        const TSharedPtr<FJsonValue> ScriptCountValue = Root->TryGetField(TEXT("expectedScriptCount"));
        if (!ScriptCountValue.IsValid())
        {
            Error = TEXT("spec expectedScriptCount is required (a non-negative integer or null)");
            return false;
        }
        if (ScriptCountValue->IsNull())
        {
            Out.ExpectedScripts = -1;
        }
        else
        {
            double Count = 0.0;
            if (ScriptCountValue->Type != EJson::Number || !ScriptCountValue->TryGetNumber(Count)
                || Count < 0.0 || Count > 2147483647.0 || FMath::FloorToDouble(Count) != Count)
            {
                Error = TEXT("spec expectedScriptCount must be a non-negative integer or null");
                return false;
            }
            Out.ExpectedScripts = static_cast<int32>(Count);
        }
        const TArray<TSharedPtr<FJsonValue>>* EnumValues = nullptr;
        if (!ReadNullableStringArray(*Root, TEXT("sourceEnums"), EnumValues, Error)) return false;
        Out.SourceEnums = DefaultEnums();
        if (EnumValues != nullptr)
        {
            Out.SourceEnums.Reset();
            if (!CollectStrings(*EnumValues, TEXT("sourceEnums"), Out.SourceEnums, Error)) return false;
        }
        // The capture block is optional here (probe-only specs): C++ reads only capture.textures,
        // the capture script validates every other key. A present block needs a typed textures list.
        Out.CaptureTextures.Reset();
        const TSharedPtr<FJsonValue> CaptureValue = Root->TryGetField(TEXT("capture"));
        if (CaptureValue.IsValid() && !CaptureValue->IsNull())
        {
            const TSharedPtr<FJsonObject>* CaptureObject = nullptr;
            if (CaptureValue->Type != EJson::Object || !CaptureValue->TryGetObject(CaptureObject) || !CaptureObject->IsValid())
            {
                Error = TEXT("spec capture must be an object");
                return false;
            }
            const TArray<TSharedPtr<FJsonValue>>* TextureValues = nullptr;
            const TSharedPtr<FJsonValue> TexturesField = (*CaptureObject)->TryGetField(TEXT("textures"));
            if (!TexturesField.IsValid() || TexturesField->Type != EJson::Array || !TexturesField->TryGetArray(TextureValues))
            {
                Error = TEXT("spec capture.textures must be an array of /Game package paths");
                return false;
            }
            for (const TSharedPtr<FJsonValue>& Value : *TextureValues)
            {
                FString TexturePackage;
                int32 TextureSlash = INDEX_NONE;
                if (!Value.IsValid() || Value->Type != EJson::String || !Value->TryGetString(TexturePackage)
                    || !TexturePackage.StartsWith(TEXT("/Game/")) || !TexturePackage.FindLastChar(TEXT('/'), TextureSlash) || TextureSlash + 1 >= TexturePackage.Len())
                {
                    Error = TEXT("spec capture.textures must be an array of /Game package paths");
                    return false;
                }
                Out.CaptureTextures.Add(TexturePackage + TEXT(".") + TexturePackage.Mid(TextureSlash + 1));
            }
        }
        return true;
    }
}
