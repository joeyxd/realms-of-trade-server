#include "ST01cRuntimeProbe.h"
#include "ST01cSpec.h"
#include "Misc/Paths.h"
#include "NiagaraComponent.h"
#include "NiagaraSystem.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraScript.h"
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
#include "Engine/TextureRenderTarget2D.h"
#include "TextureResource.h"
#include "PixelFormat.h"
#include "RenderingThread.h"

namespace
{
    bool Allowed(const UNiagaraSystem* System, const FST01cScope& Scope)
    {
        return IsInGameThread() && System && System->GetPathName() == Scope.SystemObjectPath &&
            FPaths::GetBaseFilename(FPaths::GetProjectFilePath()) == TEXT("ST01c_Pilot") &&
            FPaths::ProjectDir().Contains(TEXT("/.scratch/"));
    }
    // Older capture scripts only ever probe the exact pilot.
    bool Allowed(const UNiagaraSystem* System)
    {
        return Allowed(System, ST01cSpec::Pilot());
    }
    // The listed handles (when the spec lists them) must match in count, name and order.
    bool HandlesMatch(const UNiagaraSystem* System, const FST01cScope& Scope)
    {
        const TArray<FNiagaraEmitterHandle>& Handles = System->GetEmitterHandles();
        if (Handles.IsEmpty()) return false;
        if (!Scope.bHandlesListed) return true;
        if (Handles.Num() != Scope.Handles.Num()) return false;
        for (int32 Index = 0; Index < Handles.Num(); ++Index)
        {
            if (Handles[Index].GetName() != FName(*Scope.Handles[Index])) return false;
        }
        return true;
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

static FString ConfigureWithScope(UNiagaraSystem* System, const FST01cScope& Scope);
static FString ReadCompiledWithScope(UNiagaraSystem* System, const FST01cScope& Scope);

FString UST01cRuntimeProbe::ConfigurePilot(UNiagaraSystem* System)
{
    return ConfigureWithScope(System, ST01cSpec::Pilot());
}

FString UST01cRuntimeProbe::ConfigureSystem(UNiagaraSystem* System, const FString& SpecJson)
{
    FST01cScope Scope;
    FString Error;
    if (!ST01cSpec::Parse(SpecJson, Scope, Error)) return FString::Printf(TEXT("{\"error\":\"spec: %s\"}"), *Error);
    return ConfigureWithScope(System, Scope);
}

static FString ConfigureWithScope(UNiagaraSystem* System, const FST01cScope& Scope)
{
    if (!Allowed(System, Scope) || !HandlesMatch(System, Scope)) return TEXT("{\"error\":\"pilot scope\"}");
    auto Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("system"), System->GetPathName());
    Result->SetStringField(TEXT("overrideScope"), TEXT("in-memory comparison fixture only; originals not saved"));
    Result->SetNumberField(TEXT("warmupTime"), System->GetWarmupTime());
    Result->SetNumberField(TEXT("warmupTicks"), System->GetWarmupTickCount());
    TArray<TSharedPtr<FJsonValue>> Enums;
    for (const FString& Name : Scope.SourceEnums)
    {
        FString Path = FString::Printf(TEXT("/Niagara/Enums/%s.%s"), *Name, *Name);
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
        Data->RandomSeed = Scope.SeedBase + Index++;
        Row->SetNumberField(TEXT("fixtureSeed"), Data->RandomSeed);
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }
    System->RequestCompile(true);
    System->WaitForCompilationComplete(false, false);
    Result->SetArrayField(TEXT("emitters"), Rows);
    return Encode(Result);
}

FString UST01cRuntimeProbe::ReadCompiledPilot(UNiagaraSystem* System)
{
    return ReadCompiledWithScope(System, ST01cSpec::Pilot());
}

FString UST01cRuntimeProbe::ReadCompiledSystem(UNiagaraSystem* System, const FString& SpecJson)
{
    FST01cScope Scope;
    FString Error;
    if (!ST01cSpec::Parse(SpecJson, Scope, Error)) return FString::Printf(TEXT("{\"error\":\"spec: %s\"}"), *Error);
    return ReadCompiledWithScope(System, Scope);
}

static FString ReadCompiledWithScope(UNiagaraSystem* System, const FST01cScope& Scope)
{
    if (!Allowed(System, Scope) || !HandlesMatch(System, Scope))
        return TEXT("{\"error\":\"pilot scope\"}");
    TArray<UNiagaraScript*> Scripts = { System->GetSystemSpawnScript(), System->GetSystemUpdateScript() };
    for (const FNiagaraEmitterHandle& Handle : System->GetEmitterHandles())
    {
        auto* Data = Handle.GetEmitterData();
        if (!Data || Data->SimTarget != ENiagaraSimTarget::CPUSim)
            return TEXT("{\"error\":\"effective CPU pilot required\"}");
        TArray<UNiagaraScript*> EmitterScripts;
        Data->GetScripts(EmitterScripts, false, false);
        Scripts.Append(EmitterScripts);
    }
    // A listed count must match exactly; null records whatever the system has (bounded).
    if (Scope.ExpectedScripts >= 0 ? Scripts.Num() != Scope.ExpectedScripts : Scripts.Num() > 64)
        return TEXT("{\"error\":\"script bounds\"}");
    auto Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("schema"), TEXT("st01c-compiled-pilot/v1"));
    Result->SetStringField(TEXT("system"), System->GetPathName());
    // VectorVM's rcp opcode uses this backend estimate. These are arithmetic
    // constants, not observed particle states or a reconstructed random stream.
    TArray<TSharedPtr<FJsonValue>> Reciprocals;
    for (float Rate : { 3.0f, 10.0f })
    {
        float Estimate;
        VectorStoreFloat1(VectorReciprocalEstimate(VectorLoadFloat1(&Rate)), &Estimate);
        auto Row = MakeShared<FJsonObject>();
        Row->SetNumberField(TEXT("rate"), Rate);
        Row->SetNumberField(TEXT("estimate"), Estimate);
        Reciprocals.Add(MakeShared<FJsonValueObject>(Row));
    }
    Result->SetArrayField(TEXT("vmReciprocalEstimates"), Reciprocals);
    TArray<TSharedPtr<FJsonValue>> Rows;
    for (const UNiagaraScript* Script : Scripts)
    {
        if (!Script) return TEXT("{\"error\":\"missing script\"}");
        const auto& VM = Script->GetVMExecutableData();
        if (VM.LastHlslTranslation.Len() > 1048576)
            return TEXT("{\"error\":\"translation bounds\"}");
        auto Row = MakeShared<FJsonObject>();
        Row->SetStringField(TEXT("path"), Script->GetPathName());
        Row->SetStringField(TEXT("usage"), StaticEnum<ENiagaraScriptUsage>()->GetNameStringByValue(static_cast<int64>(Script->GetUsage())));
        Row->SetStringField(TEXT("hlsl"), VM.LastHlslTranslation);
        Row->SetStringField(TEXT("compileStatus"), StaticEnum<ENiagaraScriptCompileStatus>()->GetNameStringByValue(static_cast<int64>(VM.LastCompileStatus)));
        Rows.Add(MakeShared<FJsonValueObject>(Row));
    }
    Result->SetArrayField(TEXT("scripts"), Rows);
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

FString UST01cRuntimeProbe::ReadColorTarget(UNiagaraComponent* Component, UTextureRenderTarget2D* Target)
{
    if (!IsInGameThread() || !Component || !Allowed(Component->GetAsset()) || !Component->IsPaused())
        return TEXT("{\"error\":\"paused scoped component required\"}");
    if (!Target || Target->SizeX != 512 || Target->SizeY != 512)
        return TEXT("{\"error\":\"512x512 render target required\"}");

    const EPixelFormat PixelFormat = Target->GetFormat();
    const FTextureRenderTargetResource* Resource = Target->GameThread_GetRenderTargetResource();
    auto Result = MakeShared<FJsonObject>();
    Result->SetStringField(TEXT("schema"), TEXT("st01c-color-target/v1"));
    Result->SetStringField(TEXT("target"), Target->GetPathName());
    Result->SetNumberField(TEXT("width"), Target->SizeX);
    Result->SetNumberField(TEXT("height"), Target->SizeY);
    Result->SetNumberField(TEXT("displayGamma"), Target->GetDisplayGamma());
    Result->SetNumberField(TEXT("targetGamma"), Target->TargetGamma);
    Result->SetBoolField(TEXT("forceLinearGamma"), Target->bForceLinearGamma);
    Result->SetBoolField(TEXT("isSRGB"), Target->IsSRGB());
    Result->SetNumberField(TEXT("pixelFormatValue"), static_cast<int32>(PixelFormat));
    Result->SetStringField(TEXT("pixelFormat"), GPixelFormats[PixelFormat].Name);
    // Match CreateLUTRenderTarget's SDR fallback, without reading the rendered LUT.
    Result->SetNumberField(TEXT("sdrLutQuantizationBits"), UE::PixelFormat::HasCapabilities(PF_A2B10G10R10, EPixelFormatCapabilities::UAV) ? 10 : 8);
    Result->SetBoolField(TEXT("resourceAvailable"), Resource != nullptr);
    if (Resource)
    {
        Result->SetNumberField(TEXT("resourceDisplayGamma"), Resource->GetDisplayGamma());
        Result->SetNumberField(TEXT("resourceDisplayOutputFormat"), static_cast<uint32>(Resource->GetDisplayOutputFormat()));
        Result->SetNumberField(TEXT("resourceDisplayColorGamut"), static_cast<uint32>(Resource->GetDisplayColorGamut()));
        Result->SetBoolField(TEXT("resourceSceneHDREnabled"), Resource->GetSceneHDREnabled());
    }
    return Encode(Result);
}
