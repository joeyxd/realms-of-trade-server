#include "ST01cRuntimeProbe.h"
#include "Misc/Paths.h"
#include "NiagaraComponent.h"
#include "NiagaraSystem.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraEmitterInstance.h"
#include "NiagaraSystemInstance.h"
#include "NiagaraSystemInstanceController.h"
#include "NiagaraDataSet.h"
#include "NiagaraDataSetAccessor.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "AssetCompilingManager.h"
#include "Engine/World.h"
#include "Engine/Texture2D.h"
#include "RenderingThread.h"

namespace
{
    constexpr TCHAR PilotPath[] = TEXT("/Game/sA_Megapack_v1/sA_StylizedAttacksPack/FX/NiagaraSystems/NS_Flame_Single.NS_Flame_Single");
    bool Allowed(const UNiagaraSystem* System)
    {
        return IsInGameThread() && System && System->GetPathName() == PilotPath &&
            FPaths::GetBaseFilename(FPaths::GetProjectFilePath()) == TEXT("ST01c_Pilot") &&
            FPaths::ProjectDir().Contains(TEXT("/.scratch/"));
    }
    FString Encode(const TSharedRef<FJsonObject>& Object)
    {
        FString Out;
        FJsonSerializer::Serialize(Object, TJsonWriterFactory<>::Create(&Out));
        return Out;
    }
    TArray<TSharedPtr<FJsonValue>> Numbers(std::initializer_list<double> Values)
    {
        TArray<TSharedPtr<FJsonValue>> Out;
        for (double Value : Values) Out.Add(MakeShared<FJsonValueNumber>(Value));
        return Out;
    }
}

FString UST01cRuntimeProbe::ConfigurePilot(UNiagaraSystem* System)
{
    if (!Allowed(System) || System->GetEmitterHandles().Num() != 2) return TEXT("{\"error\":\"pilot scope\"}");
    auto Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("system"), System->GetPathName());
    Result->SetStringField(TEXT("overrideScope"), TEXT("in-memory comparison fixture only; originals not saved"));
    Result->SetNumberField(TEXT("warmupTime"), System->GetWarmupTime());
    Result->SetNumberField(TEXT("warmupTicks"), System->GetWarmupTickCount());
    TArray<TSharedPtr<FJsonValue>> Enums;
    for (const TCHAR* Name : { TEXT("ENiagaraSUbUVAnimationMode"), TEXT("ENiagaraEmitterLifeCycleMode"), TEXT("ENiagara_EmitterStateOptions"), TEXT("ENiagara_InfiniteLoopDuration"), TEXT("ENiagaraEmitterScalabilityMode_Limited"), TEXT("ENiagaraScaleColorMode") })
    {
        FString Path = FString::Printf(TEXT("/Niagara/Enums/%s.%s"), Name, Name);
        UEnum* Enum = LoadObject<UEnum>(nullptr, *Path);
        if (!Enum) return TEXT("{\"error\":\"required source enum missing\"}");
        auto Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("path"), Path);
        TArray<TSharedPtr<FJsonValue>> Entries;
        for (int32 i = 0; i < Enum->NumEnums(); ++i)
        {
            auto Entry = MakeShared<FJsonObject>();
            Entry->SetStringField(TEXT("token"), Enum->GetNameStringByIndex(i));
            Entry->SetStringField(TEXT("label"), Enum->GetDisplayNameTextByIndex(i).ToString());
            Entries.Add(MakeShared<FJsonValueObject>(Entry));
        }
        Row->SetArrayField(TEXT("entries"), Entries);
        Enums.Add(MakeShared<FJsonValueObject>(Row));
    }
    Result->SetArrayField(TEXT("sourceEnums"), Enums);
    TArray<TSharedPtr<FJsonValue>> Rows;
    int32 Index = 0;
    for (const FNiagaraEmitterHandle& Handle : System->GetEmitterHandles())
    {
        auto* Data = Handle.GetEmitterData();
        if (!Data || Data->SimTarget != ENiagaraSimTarget::CPUSim) return TEXT("{\"error\":\"CPU data missing\"}");
        auto Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("name"), Handle.GetName().ToString());
        Row->SetBoolField(TEXT("originalDeterminism"), Data->bDeterminism);
        Row->SetNumberField(TEXT("originalSeed"), Data->RandomSeed);
        Data->bDeterminism = true;
        Data->RandomSeed = 6371 + Index++;
        Row->SetNumberField(TEXT("fixtureSeed"), Data->RandomSeed);
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }
    System->RequestCompile(true);
    System->WaitForCompilationComplete(false, false);
    Result->SetArrayField(TEXT("emitters"), Rows);
    return Encode(Result);
}

FString UST01cRuntimeProbe::ReadParticles(UNiagaraComponent* Component)
{
    if (!Component || !Allowed(Component->GetAsset()) || !Component->IsPaused())
        return TEXT("{\"error\":\"paused scoped component required\"}");
    auto Controller = Component->GetSystemInstanceController();
    if (!Controller.IsValid()) return TEXT("{\"error\":\"no controller\"}");
    Controller->WaitForConcurrentTickAndFinalize();
    auto* Instance = Controller->GetSystemInstance_Unsafe();
    if (!Instance) return TEXT("{\"error\":\"no instance\"}");
    auto Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("schema"), TEXT("st01c-cpu-frame/v1"));
    Result->SetNumberField(TEXT("systemAge"), Instance->GetAge());
    Result->SetBoolField(TEXT("hasSceneProxy"), Component->GetSceneProxy() != nullptr);
    Result->SetBoolField(TEXT("visible"), Component->IsVisible());
    Result->SetBoolField(TEXT("active"), Component->IsActive());
    TArray<TSharedPtr<FJsonValue>> Rows;
    for (const auto& Emitter : Instance->GetEmitters())
    {
        if (Emitter->GetCachedEmitterData()->SimTarget != ENiagaraSimTarget::CPUSim)
            return TEXT("{\"error\":\"CPU emitter required\"}");
        const auto& Data = Emitter->GetParticleData();
        const auto* Buffer = Data.GetCurrentData();
        if (!Buffer || Buffer->GetNumInstances() > 4096) return TEXT("{\"error\":\"particle bounds\"}");
        auto Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("name"), Emitter->GetEmitterHandle().GetName().ToString());
        if (Buffer->GetNumInstances() == 0)
        {
            Row->SetArrayField(TEXT("particles"), {});
            Rows.Add(MakeShared<FJsonValueObject>(Row));
            continue;
        }
        const auto Position = FNiagaraDataSetAccessor<FNiagaraPosition>(Data, TEXT("Position")).GetReader(Data);
        const auto Velocity = FNiagaraDataSetAccessor<FVector3f>(Data, TEXT("Velocity")).GetReader(Data);
        const auto Color = FNiagaraDataSetAccessor<FLinearColor>(Data, TEXT("Color")).GetReader(Data);
        const auto Size = FNiagaraDataSetAccessor<FVector2f>(Data, TEXT("SpriteSize")).GetReader(Data);
        const auto Rotation = FNiagaraDataSetAccessor<float>(Data, TEXT("SpriteRotation")).GetReader(Data);
        const auto SubImage = FNiagaraDataSetAccessor<float>(Data, TEXT("SubImageIndex")).GetReader(Data);
        const auto Age = FNiagaraDataSetAccessor<float>(Data, TEXT("Age")).GetReader(Data);
        const auto Lifetime = FNiagaraDataSetAccessor<float>(Data, TEXT("Lifetime")).GetReader(Data);
        const auto Id = FNiagaraDataSetAccessor<int32>(Data, TEXT("UniqueID")).GetReader(Data);
        if (!Position.IsValid() || !Color.IsValid() || !Size.IsValid() || !Rotation.IsValid() || !SubImage.IsValid())
        {
            Result->SetStringField(TEXT("error"), TEXT("renderer attribute missing"));
            TArray<TSharedPtr<FJsonValue>> Variables;
            for (const auto& V : Data.GetCompiledData().Variables)
                Variables.Add(MakeShared<FJsonValueString>(V.GetName().ToString() + TEXT(":") + V.GetType().GetName()));
            Result->SetArrayField(TEXT("availableAttributes"), Variables);
            return Encode(Result);
        }
        TArray<TSharedPtr<FJsonValue>> Particles;
        for (int32 i = 0; i < static_cast<int32>(Buffer->GetNumInstances()); ++i)
        {
            auto P = MakeShared<FJsonObject>();
            const auto Pos = Position.Get(i); const auto Col = Color.Get(i); const auto Sz = Size.Get(i);
            P->SetArrayField(TEXT("position"), Numbers({ Pos.X, Pos.Y, Pos.Z }));
            P->SetArrayField(TEXT("color"), Numbers({ Col.R, Col.G, Col.B, Col.A }));
            P->SetArrayField(TEXT("size"), Numbers({ Sz.X, Sz.Y }));
            P->SetNumberField(TEXT("rotation"), Rotation.Get(i));
            P->SetNumberField(TEXT("subImage"), SubImage.Get(i));
            if (Velocity.IsValid()) { auto V = Velocity.Get(i); P->SetArrayField(TEXT("velocity"), Numbers({ V.X, V.Y, V.Z })); }
            if (Age.IsValid()) P->SetNumberField(TEXT("age"), Age.Get(i));
            if (Lifetime.IsValid()) P->SetNumberField(TEXT("lifetime"), Lifetime.Get(i));
            if (Id.IsValid()) P->SetNumberField(TEXT("uniqueId"), Id.Get(i));
            Particles.Add(MakeShared<FJsonValueObject>(P));
        }
        Row->SetArrayField(TEXT("particles"), Particles);
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }
    Result->SetArrayField(TEXT("emitters"), Rows);
    return Encode(Result);
}

FString UST01cRuntimeProbe::PrepareCapture(UNiagaraComponent* Component)
{
    if (!Component || !Allowed(Component->GetAsset()) || !Component->IsPaused())
        return TEXT("{\"error\":\"paused scoped component required\"}");
    FAssetCompilingManager::Get().FinishAllCompilation();
    for (const TCHAR* Name : { TEXT("T_FlameUV_2"), TEXT("T_Smoke_1") })
    {
        const FString Path = FString::Printf(TEXT("/Game/sA_Megapack_v1/sA_StylizedAttacksPack/Materials/Textures/%s.%s"), Name, Name);
        UTexture2D* Texture = LoadObject<UTexture2D>(nullptr, *Path);
        if (!Texture) return TEXT("{\"error\":\"pilot texture missing\"}");
        Texture->SetForceMipLevelsToBeResident(60.0f);
        Texture->WaitForStreaming();
    }
    Component->MarkRenderStateDirty();
    Component->GetWorld()->SendAllEndOfFrameUpdates();
    FlushRenderingCommands();
    return TEXT("{\"prepared\":true}");
}
