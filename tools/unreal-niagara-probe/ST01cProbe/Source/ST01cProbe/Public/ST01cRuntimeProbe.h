#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "ST01cRuntimeProbe.generated.h"

class UNiagaraSystem;
class UNiagaraComponent;
class UTextureRenderTarget2D;

// Editor-only, bounded observation of the isolated pilot. Never saves an asset.
UCLASS()
class ST01CPROBE_API UST01cRuntimeProbe final : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()
public:
    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ConfigurePilot(UNiagaraSystem* System);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ReadCompiledPilot(UNiagaraSystem* System);

    // Same as ConfigurePilot/ReadCompiledPilot, but the scope (system, handles,
    // seed base, script count) comes from a systems/<name>.json spec text.
    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ConfigureSystem(UNiagaraSystem* System, const FString& SpecJson);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ReadCompiledSystem(UNiagaraSystem* System, const FString& SpecJson);

    // ReadParticles, PrepareCapture and ReadColorTarget accept only the system the last
    // successful ConfigurePilot/ConfigureSystem call configured; PrepareCapture forces the
    // spec's capture.textures resident (the pilot's two textures after ConfigurePilot).
    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ReadParticles(UNiagaraComponent* Component);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString PrepareCapture(UNiagaraComponent* Component);

    UFUNCTION(BlueprintCallable, Category="ST01c")
    static FString ReadColorTarget(UNiagaraComponent* Component, UTextureRenderTarget2D* Target);
};
