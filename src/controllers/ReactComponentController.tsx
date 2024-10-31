import { Suspense } from 'react';
import { ModuleNamespace } from 'vite/types/hot';
import { AppShell } from '@mantine/core';
import { ReactComponent } from '../parser/types';
import { StimulusParams } from '../store/types';
import ResourceNotFound from '../ResourceNotFound';
import { useStoreDispatch, useStoreActions } from '../store/store';
import { useCurrentComponent, useCurrentStep } from '../routes/utils';
import { AnalysisPopout } from '../components/audioAnalysis/AnalysisPopout';

const modules = import.meta.glob(
  '../public/**/*.{mjs,js,mts,ts,jsx,tsx}',
  { eager: true },
);

function ReactComponentController({ currentConfig, provState }: { currentConfig: ReactComponent; provState?: unknown }) {
  const currentStep = useCurrentStep();
  const currentComponent = useCurrentComponent();

  const reactPath = `../public/${currentConfig.path}`;
  const StimulusComponent = reactPath in modules ? (modules[reactPath] as ModuleNamespace).default : null;

  const storeDispatch = useStoreDispatch();
  const { updateResponseBlockValidation, setIframeAnswers } = useStoreActions();
  function setAnswer({ status, provenanceGraph, answers }: Parameters<StimulusParams<unknown>['setAnswer']>[0]) {
    storeDispatch(updateResponseBlockValidation({
      location: 'sidebar',
      identifier: `${currentComponent}_${currentStep}`,
      status,
      values: answers,
      provenanceGraph,
    }));

    storeDispatch(setIframeAnswers(answers));
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      {StimulusComponent
        ? (
          <StimulusComponent
            parameters={currentConfig.parameters}
            // eslint-disable-next-line react/jsx-no-bind
            setAnswer={setAnswer}
            provState={provState}
          />
        )
        : <ResourceNotFound path={currentConfig.path} />}
      {currentStep.toString().startsWith('reviewer-') ? (
        <AppShell.Footer p="md">
          <AnalysisPopout />
        </AppShell.Footer>
      ) : null }
    </Suspense>
  );
}

export default ReactComponentController;
