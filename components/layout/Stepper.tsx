import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Step {
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
}

export default function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <>
    <div className="sm:hidden mb-5 rounded-xl bg-gray-100 p-3 dark:bg-gray-800" aria-label={`Step ${currentStep + 1} of ${steps.length}`}>
      <div className="flex justify-between gap-3 text-sm font-medium"><span>Step {currentStep + 1} of {steps.length}</span><span>{steps[currentStep]?.label}</span></div>
      <div className="h-1 mt-3 rounded bg-gray-300 dark:bg-gray-700"><div className="h-1 rounded bg-gray-900 dark:bg-white" style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} /></div>
    </div>
    <div className="hidden sm:flex items-center gap-0 mb-8">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <div key={step.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors',
                  isCompleted
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : isCurrent
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
                )}
              >
                {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
              </div>
              <span
                className={cn(
                  'text-xs mt-1 font-medium text-center max-w-[80px]',
                  isCurrent || isCompleted
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-400 dark:text-gray-600'
                )}
              >
                {step.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-[2px] mx-2 mb-4',
                  index < currentStep ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
    </>
  );
}
