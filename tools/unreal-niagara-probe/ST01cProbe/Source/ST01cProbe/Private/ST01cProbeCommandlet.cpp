#include "ST01cProbeCommandlet.h"

#include "Misc/CommandLine.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Materials/MaterialInterface.h"
#include "Modules/ModuleManager.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraParameterStore.h"
#include "NiagaraRendererProperties.h"
#include "NiagaraScript.h"
#include "NiagaraScriptSourceBase.h"
#include "NiagaraSpriteRendererProperties.h"
#include "NiagaraSystem.h"
#include "NiagaraTypes.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UObject/UnrealType.h"

namespace
{
    constexpr TCHAR PilotSystemPath[] = TEXT("/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single.NS_Flame_Single");
    constexpr TCHAR PilotSystemSourceSha256[] = TEXT("985a431dc6c0d1ca1c43a31765754bae7cc78b853ca1fcadc1fa3fd093ec2165");
    constexpr const TCHAR* ExpectedEmitterNames[] = { TEXT("NE_Flame_Basic_001"), TEXT("NE_Smoke_Basic") };

    FString GuidString(const FGuid& Guid)
    {
        return Guid.ToString(EGuidFormats::DigitsWithHyphensLower);
    }

    FString ByteHex(const uint8* Data, int32 Count)
    {
        FString Result;
        Result.Reserve(Count * 2);
        for (int32 Index = 0; Index < Count; ++Index)
        {
            Result += FString::Printf(TEXT("%02x"), Data[Index]);
        }
        return Result;
    }

    TSharedRef<FJsonObject> NewObject()
    {
        return MakeShared<FJsonObject>();
    }

    TArray<TSharedPtr<FJsonValue>> NumberArray(std::initializer_list<double> Numbers)
    {
        TArray<TSharedPtr<FJsonValue>> Result;
        Result.Reserve(static_cast<int32>(Numbers.size()));
        for (double Number : Numbers)
        {
            Result.Add(MakeShared<FJsonValueNumber>(Number));
        }
        return Result;
    }

    TSharedRef<FJsonObject> ExportTypedValue(const FNiagaraVariableWithOffset& Variable, const uint8* Data, int32 Size)
    {
        const FNiagaraTypeDefinition& Type = Variable.GetType();
        const FNiagaraTypeDefinition StorageType = Type.RemoveStaticDef();
        TSharedRef<FJsonObject> Value = NewObject();
        Value->SetStringField(TEXT("typeName"), Type.GetName());
        Value->SetStringField(TEXT("typePath"), Type.ClassStructOrEnum ? Type.ClassStructOrEnum->GetPathName() : FString());
        Value->SetNumberField(TEXT("byteSize"), Size);
        Value->SetBoolField(TEXT("staticType"), Type.IsStatic());
        Value->SetStringField(TEXT("rawBytesHex"), ByteHex(Data, Size));

        if (StorageType == FNiagaraTypeDefinition::GetFloatDef() && Size == sizeof(FNiagaraFloat))
        {
            FNiagaraFloat Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("NiagaraFloat"));
            Value->SetNumberField(TEXT("value"), Typed.Value);
        }
        else if (StorageType == FNiagaraTypeDefinition::GetIntDef() && Size == sizeof(FNiagaraInt32))
        {
            FNiagaraInt32 Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("NiagaraInt32"));
            Value->SetNumberField(TEXT("value"), Typed.Value);
        }
        else if (StorageType == FNiagaraTypeDefinition::GetBoolDef() && Size == sizeof(FNiagaraBool))
        {
            FNiagaraBool Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("NiagaraBool"));
            Value->SetBoolField(TEXT("value"), Typed.GetValue());
            Value->SetNumberField(TEXT("rawValue"), Typed.GetRawValue());
        }
        else if (StorageType == FNiagaraTypeDefinition::GetVec2Def() && Size == sizeof(FVector2f))
        {
            FVector2f Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("FVector2f"));
            Value->SetArrayField(TEXT("value"), NumberArray({ Typed.X, Typed.Y }));
        }
        else if (StorageType == FNiagaraTypeDefinition::GetVec3Def() && Size == sizeof(FVector3f))
        {
            FVector3f Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("FVector3f"));
            Value->SetArrayField(TEXT("value"), NumberArray({ Typed.X, Typed.Y, Typed.Z }));
        }
        else if (StorageType == FNiagaraTypeDefinition::GetVec4Def() && Size == sizeof(FVector4f))
        {
            FVector4f Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("FVector4f"));
            Value->SetArrayField(TEXT("value"), NumberArray({ Typed.X, Typed.Y, Typed.Z, Typed.W }));
        }
        else if (StorageType == FNiagaraTypeDefinition::GetColorDef() && Size == sizeof(FLinearColor))
        {
            FLinearColor Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("FLinearColor"));
            Value->SetArrayField(TEXT("value"), NumberArray({ Typed.R, Typed.G, Typed.B, Typed.A }));
        }
        else if (StorageType == FNiagaraTypeDefinition::GetQuatDef() && Size == sizeof(FQuat4f))
        {
            FQuat4f Typed;
            FMemory::Memcpy(&Typed, Data, sizeof(Typed));
            Value->SetStringField(TEXT("decodedAs"), TEXT("FQuat4f"));
            Value->SetArrayField(TEXT("value"), NumberArray({ Typed.X, Typed.Y, Typed.Z, Typed.W }));
        }
        else
        {
            Value->SetStringField(TEXT("decodedAs"), TEXT("opaque"));
        }

        return Value;
    }

    bool ExportRapidIteration(const UNiagaraScript& Script, TArray<TSharedPtr<FJsonValue>>& OutParameters, FString& OutError)
    {
        const FNiagaraParameterStore& Store = Script.RapidIterationParameters;
        const TArrayView<const FNiagaraVariableWithOffset> Variables = Store.ReadParameterVariables();
        const FStructProperty* HandleProperty = FindFProperty<FStructProperty>(FNiagaraVariableBase::StaticStruct(), TEXT("TypeDefHandle"));
        const FIntProperty* IndexProperty = FindFProperty<FIntProperty>(FNiagaraTypeDefinitionHandle::StaticStruct(), TEXT("RegisteredTypeIndex"));
        if (!HandleProperty || !IndexProperty)
        {
            OutError = TEXT("Niagara type-handle reflection properties are unavailable");
            return false;
        }

        for (const FNiagaraVariableWithOffset& Variable : Variables)
        {
            const FNiagaraTypeDefinition& Type = Variable.GetType();
            const int32 Size = Type.IsValid() ? Type.GetSize() : 0;
            const uint8* Data = Store.GetParameterData(Variable);
            if (!Type.IsValid() || Size <= 0 || Size > 4096 || Data == nullptr)
            {
                OutError = FString::Printf(TEXT("Invalid parameter data for %s"), *Variable.GetName().ToString());
                return false;
            }

            const FNiagaraVariableBase* BaseVariable = static_cast<const FNiagaraVariableBase*>(&Variable);
            const void* HandleMemory = HandleProperty->ContainerPtrToValuePtr<void>(const_cast<FNiagaraVariableBase*>(BaseVariable));
            const int32 TypeIndex = IndexProperty->GetPropertyValue(IndexProperty->ContainerPtrToValuePtr<void>(const_cast<void*>(HandleMemory)));

            TSharedRef<FJsonObject> Parameter = NewObject();
            Parameter->SetStringField(TEXT("name"), Variable.GetName().ToString());
            Parameter->SetNumberField(TEXT("offset"), Variable.Offset);
            Parameter->SetNumberField(TEXT("registeredTypeIndexDiagnostic"), TypeIndex);
            Parameter->SetStringField(TEXT("typeName"), Type.GetName());
            Parameter->SetStringField(TEXT("typePath"), Type.ClassStructOrEnum ? Type.ClassStructOrEnum->GetPathName() : FString());
            Parameter->SetNumberField(TEXT("byteSize"), Size);
            Parameter->SetObjectField(TEXT("value"), ExportTypedValue(Variable, Data, Size));
            OutParameters.Add(MakeShared<FJsonValueObject>(Parameter));
        }

        return true;
    }
}

UST01cProbeCommandlet::UST01cProbeCommandlet()
{
    IsClient = false;
    IsServer = false;
    IsEditor = true;
    LogToConsole = true;
}

int32 UST01cProbeCommandlet::Main(const FString& Params)
{
    FString OutputPath;
    if (!FParse::Value(*Params, TEXT("Output="), OutputPath) || OutputPath.IsEmpty())
    {
        UE_LOG(LogTemp, Error, TEXT("Required argument missing: -Output=<absolute-json-path>"));
        return 2;
    }

    OutputPath = FPaths::ConvertRelativePathToFull(OutputPath);
    if (FPaths::GetBaseFilename(FPaths::GetProjectFilePath()) != TEXT("ST01c_Pilot") ||
        !FPaths::ProjectDir().Contains(TEXT("/.scratch/")) ||
        !FPaths::IsUnderDirectory(OutputPath, FPaths::ProjectDir()) || FPaths::FileExists(OutputPath))
    {
        UE_LOG(LogTemp, Error, TEXT("Probe requires this isolated project and a fresh output inside it"));
        return 2;
    }
    UNiagaraSystem* System = LoadObject<UNiagaraSystem>(nullptr, PilotSystemPath);
    if (!System)
    {
        UE_LOG(LogTemp, Error, TEXT("Could not load exact pilot system: %s"), PilotSystemPath);
        return 3;
    }

    const TArray<FNiagaraEmitterHandle>& Handles = System->GetEmitterHandles();
    if (Handles.Num() != 2)
    {
        UE_LOG(LogTemp, Error, TEXT("Expected exactly 2 emitter handles; found %d"), Handles.Num());
        return 4;
    }

    TSharedRef<FJsonObject> Root = NewObject();
    Root->SetStringField(TEXT("schema"), TEXT("st01c-native-api-probe/v1"));
    Root->SetStringField(TEXT("engineVersion"), FEngineVersion::Current().ToString());
    Root->SetStringField(TEXT("systemObjectPath"), System->GetPathName());
    Root->SetStringField(TEXT("expectedSourceSystemSha256"), PilotSystemSourceSha256);
    Root->SetStringField(TEXT("shaValidation"), TEXT("external-only; commandlet does not hash the uasset"));
    Root->SetNumberField(TEXT("emitterHandleCount"), Handles.Num());
    TArray<TSharedPtr<FJsonValue>> Emitters;

    for (int32 HandleIndex = 0; HandleIndex < Handles.Num(); ++HandleIndex)
    {
        const FNiagaraEmitterHandle& Handle = Handles[HandleIndex];
        if (Handle.GetName() != FName(ExpectedEmitterNames[HandleIndex]))
        {
            UE_LOG(LogTemp, Error, TEXT("Unexpected emitter at order %d: %s"), HandleIndex, *Handle.GetName().ToString());
            return 4;
        }
        const FVersionedNiagaraEmitter Instance = Handle.GetInstance();
        FVersionedNiagaraEmitterData* Data = Handle.GetEmitterData();
        if (!Instance.Emitter || !Data)
        {
            UE_LOG(LogTemp, Error, TEXT("Emitter handle %d has no resolved version data"), HandleIndex);
            return 5;
        }

        TSharedRef<FJsonObject> Emitter = NewObject();
        Emitter->SetNumberField(TEXT("handleOrder"), HandleIndex);
        Emitter->SetStringField(TEXT("handleName"), Handle.GetName().ToString());
        Emitter->SetStringField(TEXT("handleId"), GuidString(Handle.GetId()));
        Emitter->SetBoolField(TEXT("enabled"), Handle.GetIsEnabled());
        Emitter->SetStringField(TEXT("emitterObjectPath"), Instance.Emitter->GetPathName());
        Emitter->SetStringField(TEXT("requestedVersionGuid"), GuidString(Instance.Version));
        Emitter->SetBoolField(TEXT("requestedVersionGuidValid"), Instance.Version.IsValid());
        Emitter->SetBoolField(TEXT("versioningEnabled"), Instance.Emitter->IsVersioningEnabled());
        Emitter->SetStringField(TEXT("exposedVersionGuid"), GuidString(Instance.Emitter->GetExposedVersion().VersionGuid));
        Emitter->SetStringField(TEXT("resolvedVersionGuid"), GuidString(Data->Version.VersionGuid));
        Emitter->SetStringField(TEXT("graphSourceObjectPath"), Data->GraphSource ? Data->GraphSource->GetPathName() : FString());
        Emitter->SetBoolField(TEXT("localSpace"), Data->bLocalSpace);
        Emitter->SetBoolField(TEXT("determinism"), Data->bDeterminism);
        Emitter->SetNumberField(TEXT("randomSeed"), Data->RandomSeed);
        Emitter->SetStringField(TEXT("simTarget"), StaticEnum<ENiagaraSimTarget>()->GetNameStringByValue(static_cast<int64>(Data->SimTarget)));
        Emitter->SetStringField(TEXT("versionedParentObjectPath"), Data->VersionedParent.Emitter ? Data->VersionedParent.Emitter->GetPathName() : FString());
        Emitter->SetStringField(TEXT("versionedParentGuid"), GuidString(Data->VersionedParent.Version));
        Emitter->SetStringField(TEXT("versionedParentAtLastMergeObjectPath"), Data->VersionedParentAtLastMerge.Emitter ? Data->VersionedParentAtLastMerge.Emitter->GetPathName() : FString());
        Emitter->SetStringField(TEXT("versionedParentAtLastMergeGuid"), GuidString(Data->VersionedParentAtLastMerge.Version));

        TArray<TSharedPtr<FJsonValue>> Renderers;
        const TArray<UNiagaraRendererProperties*>& RendererProperties = Data->GetRenderers();
        if (RendererProperties.IsEmpty())
        {
            UE_LOG(LogTemp, Error, TEXT("Resolved emitter %s has no renderer entries"), *Handle.GetName().ToString());
            return 6;
        }
        for (int32 RendererIndex = 0; RendererIndex < RendererProperties.Num(); ++RendererIndex)
        {
            const UNiagaraRendererProperties* Renderer = RendererProperties[RendererIndex];
            if (!Renderer)
            {
                UE_LOG(LogTemp, Error, TEXT("Emitter %s has null renderer at index %d"), *Handle.GetName().ToString(), RendererIndex);
                return 6;
            }
            TSharedRef<FJsonObject> RendererJson = NewObject();
            RendererJson->SetNumberField(TEXT("rendererOrder"), RendererIndex);
            RendererJson->SetStringField(TEXT("objectPath"), Renderer->GetPathName());
            RendererJson->SetStringField(TEXT("classPath"), Renderer->GetClass()->GetPathName());
            RendererJson->SetBoolField(TEXT("enabled"), Renderer->GetIsEnabled());
            if (const UNiagaraSpriteRendererProperties* Sprite = Cast<UNiagaraSpriteRendererProperties>(Renderer))
            {
                RendererJson->SetStringField(TEXT("kind"), TEXT("sprite"));
                RendererJson->SetStringField(TEXT("materialPath"), Sprite->Material ? Sprite->Material->GetPathName() : FString());
                RendererJson->SetStringField(TEXT("materialUserParameter"), Sprite->MaterialUserParamBinding.Parameter.GetName().ToString());
                RendererJson->SetArrayField(TEXT("subImageSize"), NumberArray({ Sprite->SubImageSize.X, Sprite->SubImageSize.Y }));
                RendererJson->SetBoolField(TEXT("subImageBlend"), Sprite->bSubImageBlend != 0);
                RendererJson->SetStringField(TEXT("alignment"), StaticEnum<ENiagaraSpriteAlignment>()->GetNameStringByValue(static_cast<int64>(Sprite->Alignment)));
                RendererJson->SetStringField(TEXT("facingMode"), StaticEnum<ENiagaraSpriteFacingMode>()->GetNameStringByValue(static_cast<int64>(Sprite->FacingMode)));
            }
            else
            {
                RendererJson->SetStringField(TEXT("kind"), TEXT("other"));
            }
            Renderers.Add(MakeShared<FJsonValueObject>(RendererJson));
        }
        Emitter->SetArrayField(TEXT("activeVersionRendererArray"), Renderers);

        TArray<UNiagaraScript*> Scripts;
        Data->GetScripts(Scripts, false, false);
        if (Scripts.IsEmpty())
        {
            UE_LOG(LogTemp, Error, TEXT("Resolved emitter %s has no script entries"), *Handle.GetName().ToString());
            return 7;
        }
        TArray<TSharedPtr<FJsonValue>> ScriptJsonValues;
        for (const UNiagaraScript* Script : Scripts)
        {
            if (!Script)
            {
                UE_LOG(LogTemp, Error, TEXT("Emitter %s has a null script entry"), *Handle.GetName().ToString());
                return 7;
            }
            TSharedRef<FJsonObject> ScriptJson = NewObject();
            ScriptJson->SetStringField(TEXT("objectPath"), Script->GetPathName());
            ScriptJson->SetStringField(TEXT("usage"), StaticEnum<ENiagaraScriptUsage>()->GetNameStringByValue(static_cast<int64>(Script->GetUsage())));
            ScriptJson->SetStringField(TEXT("usageId"), GuidString(Script->GetUsageId()));
            TArray<TSharedPtr<FJsonValue>> Parameters;
            FString ParameterError;
            if (!ExportRapidIteration(*Script, Parameters, ParameterError))
            {
                UE_LOG(LogTemp, Error, TEXT("Rapid iteration extraction failed for %s: %s"), *Script->GetPathName(), *ParameterError);
                return 8;
            }
            ScriptJson->SetArrayField(TEXT("rapidIterationParameters"), Parameters);
            ScriptJsonValues.Add(MakeShared<FJsonValueObject>(ScriptJson));
        }
        Emitter->SetArrayField(TEXT("scripts"), ScriptJsonValues);
        Emitters.Add(MakeShared<FJsonValueObject>(Emitter));
    }
    Root->SetArrayField(TEXT("emitters"), Emitters);

    FString JsonText;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonText);
    if (!FJsonSerializer::Serialize(Root, Writer))
    {
        UE_LOG(LogTemp, Error, TEXT("JSON serialization failed"));
        return 9;
    }
    if (!FFileHelper::SaveStringToFile(JsonText, *OutputPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM))
    {
        UE_LOG(LogTemp, Error, TEXT("Could not write output: %s"), *OutputPath);
        return 10;
    }

    UE_LOG(LogTemp, Display, TEXT("Read-only ST01c metadata written to %s"), *OutputPath);
    return 0;
}

IMPLEMENT_MODULE(FDefaultModuleImpl, ST01cProbe)
